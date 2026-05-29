import { request } from "undici";
import { XMLParser } from "fast-xml-parser";
import { ConnectorError } from "../../../utils/errors.js";
import { logger } from "../../../config/logger.js";

/**
 * Low-level Yuki SOAP transport.
 *
 * Yuki exposes SOAP 1.2 endpoints at https://api.yukiworks.nl/ws/{Service}.asmx
 * The authentication flow is:
 *   1. Authenticate(accessKey) → returns a sessionID (GUID) valid for the call chain
 *   2. {Method}(sessionID, administrationID, ...) on the same service URL
 *
 * Notes:
 *  - TLS 1.2+ is mandatory (handled by Node automatically).
 *  - Content-Type must be `application/soap+xml; charset=utf-8`.
 *  - SOAPAction header MUST be set to `http://www.theyukicompany.com/{Method}`.
 *  - Response is a SOAP envelope; the operation result lives at
 *    /soap:Envelope/soap:Body/{Method}Response/{Method}Result
 */

const NAMESPACE = "http://www.theyukicompany.com/";
const SOAP_ENVELOPE_OPEN =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"' +
  ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
  ' xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
  "<soap12:Body>";
const SOAP_ENVELOPE_CLOSE = "</soap12:Body></soap12:Envelope>";

export type YukiService = "Accounting" | "AccountingInfo" | "Sales" | "Contact" | "Archive";

const BASE_URL = "https://api.yukiworks.nl/ws";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  // Flatten attributes (no "@_" prefix) so they live alongside child elements —
  // YukiConnector's mapper expects this convention (e.g. `r.Code`, `r.BalanceType`).
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  // Without this, GL codes like "01250" lose their leading zero (parsed as 1250),
  // which breaks the code→name join with the trial balance for ~20% of accounts.
  numberParseOptions: { leadingZeros: false, hex: false },
  // fast-xml-parser's default entity-expansion guard (maxTotalExpansions 1000)
  // is a billion-laughs DoS protection meant for untrusted XML. Yuki responses
  // are first-party (TLS) and legitimately contain thousands of predefined
  // character references — every "\r\n" in a transaction description arrives as
  // &#xD;&#xA; — so a busy period trips the cap and throws. Raise the limits well
  // past any realistic response size; there are no custom DOCTYPE entities here.
  processEntities: {
    maxTotalExpansions: 50_000_000,
    maxEntityCount: 50_000_000,
    maxExpandedLength: 500_000_000,
  },
});

export interface YukiSoapOptions {
  /** Raw inner-body XML (between <soap12:Body> and </soap12:Body>). */
  bodyXml: string;
  method: string;
  service: YukiService;
  /** Per-call timeout. Defaults to 30s. */
  timeoutMs?: number;
}

export class YukiSoapClient {
  /**
   * Authenticate(accessKey) → returns sessionID GUID.
   * The accessKey is the WebserviceAccessKey configured in the Yuki portal.
   */
  async authenticate(accessKey: string, service: YukiService = "Accounting"): Promise<string> {
    const body =
      `<Authenticate xmlns="${NAMESPACE}">` +
      `<accessKey>${escapeXml(accessKey)}</accessKey>` +
      `</Authenticate>`;

    const result = await this.call({ bodyXml: body, method: "Authenticate", service });
    // The response is /AuthenticateResponse/AuthenticateResult, a GUID string.
    const sessionId = (result as { AuthenticateResponse?: { AuthenticateResult?: unknown } })
      ?.AuthenticateResponse?.AuthenticateResult;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new ConnectorError("Yuki Authenticate returned no sessionID", { result });
    }
    return sessionId;
  }

  /**
   * Generic POST of a SOAP envelope. Returns the parsed XML body (namespaces stripped).
   * On SOAP Fault returns a typed ConnectorError.
   */
  async call(opts: YukiSoapOptions): Promise<Record<string, unknown>> {
    const url = `${BASE_URL}/${opts.service}.asmx`;
    const envelope = SOAP_ENVELOPE_OPEN + opts.bodyXml + SOAP_ENVELOPE_CLOSE;

    logger.debug(
      { service: opts.service, method: opts.method, envelope },
      "Yuki SOAP request",
    );

    const { statusCode, body } = await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml; charset=utf-8",
        SOAPAction: `${NAMESPACE}${opts.method}`,
      },
      body: envelope,
      // Yuki can be slow for chunks covering high-activity months — bump from undici's
      // default 30s to 60s before declaring the request dead.
      bodyTimeout: opts.timeoutMs ?? 60_000,
      headersTimeout: opts.timeoutMs ?? 60_000,
    });

    const text = await body.text();

    // Always log raw responses at debug level — essential for iterating on
    // AccountingInfo method names and figuring out actual response shapes.
    logger.debug(
      { service: opts.service, method: opts.method, statusCode, response: text },
      "Yuki SOAP response",
    );

    if (statusCode >= 400) {
      logger.warn(
        { service: opts.service, method: opts.method, statusCode, snippet: text.slice(0, 1000) },
        "Yuki SOAP error response",
      );
      throw new ConnectorError(
        `Yuki ${opts.service}.${opts.method} returned HTTP ${statusCode}`,
        { statusCode, snippet: text.slice(0, 1000) },
      );
    }

    const parsed = xmlParser.parse(text) as Record<string, unknown>;
    // After removeNSPrefix: /Envelope/Body/...
    const envBody = (parsed as any)?.Envelope?.Body;
    if (!envBody) {
      throw new ConnectorError(`Malformed SOAP response from Yuki ${opts.method}`);
    }
    if (envBody.Fault) {
      const reason = envBody.Fault.Reason?.Text ?? envBody.Fault.faultstring ?? "Yuki SOAP fault";
      throw new ConnectorError(`Yuki fault on ${opts.method}: ${reason}`, envBody.Fault);
    }
    return envBody as Record<string, unknown>;
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
