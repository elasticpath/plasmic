/**
 * Clover API types — manually defined since Clover has no npm type package.
 *
 * WHY: Clover's SDK is loaded via script tag at runtime (PCI SAQ-A compliance).
 * These types cover the charge API, 3DS data shapes, and finalization responses
 * needed by the clover-adapter and clover-api modules.
 */

// ---------------------------------------------------------------------------
// 3DS Data — returned inside CloverChargeResponse.threeDsData
// ---------------------------------------------------------------------------

export interface Clover3DSMethodData {
  _3DSServerTransId: string;
  acsMethodUrl: string;
  methodNotificationUrl: string;
}

export interface Clover3DSChallengeData {
  messageVersion: string;
  acsTransID: string;
  acsUrl: string;
  threeDSServerTransID: string;
}

// ---------------------------------------------------------------------------
// Charge request / response
// ---------------------------------------------------------------------------

export interface CloverChargeRequest {
  source: string;
  amount: number;
  currency: string;
  description?: string;
}

export interface CloverChargeResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
  source?: { last4?: string; brand?: string };
  threeDsData?: {
    status: string;
    methodData?: Clover3DSMethodData;
    challengeData?: Clover3DSChallengeData;
  };
}

// ---------------------------------------------------------------------------
// Finalize payment request (3DS completion)
// ---------------------------------------------------------------------------

export interface CloverFinalizeRequest {
  charge_id: string;
  threeds: {
    source: "CLOVER";
    flow_status: string;
  };
}

// ---------------------------------------------------------------------------
// Clover SDK types (client-side, loaded via script tag)
// ---------------------------------------------------------------------------

export interface CloverTokenResult {
  token?: string;
  errors?: Array<{ message: string; param?: string }>;
}

export type CloverFieldType =
  | "CARD_NUMBER"
  | "CARD_DATE"
  | "CARD_CVV"
  | "CARD_POSTAL_CODE";

export interface CloverFieldInstance {
  mount: (selector: string) => void;
  destroy: () => void;
  addEventListener: (
    event: string,
    callback: (event: Record<string, unknown>) => void
  ) => void;
  removeEventListener: (
    event: string,
    callback: (event: Record<string, unknown>) => void
  ) => void;
}

export interface CloverElementsInstance {
  create: (
    type: string,
    styles?: Record<string, Record<string, string>>
  ) => CloverFieldInstance;
}

export interface CloverSdkInstance {
  elements: () => CloverElementsInstance;
  createToken: () => Promise<CloverTokenResult>;
}

export interface CloverConstructor {
  new (
    pakmsKey: string,
    options?: { merchantId?: string; locale?: string }
  ): CloverSdkInstance;
}

// ---------------------------------------------------------------------------
// 3DS SDK types (window.clover3DSUtil)
// ---------------------------------------------------------------------------

export interface Clover3DSUtil {
  perform3DSFingerPrinting(params: {
    _3DSServerTransId: string;
    acsMethodUrl: string;
    methodNotificationUrl: string;
  }): void;
  perform3DSChallenge(params: {
    messageVersion: string;
    acsTransID: string;
    acsUrl: string;
    threeDSServerTransID: string;
  }): void;
}
