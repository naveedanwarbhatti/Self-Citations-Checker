// types.ts

// These types are shared between the content and background scripts.
// 'export' is used so these types can be imported into other files.

export interface SuccessResponse {
  status: 'success';
  selfCitations: number;
  totalCitations: number;
  percentage: number;
  message?: string; // Optional message for debugging
}

export interface ErrorResponse {
  status: 'error';
  message: string;
}

/**
 * NEW: A dedicated response type for when the DBLP API is busy.
 */
export interface RateLimitErrorResponse {
    status: 'rate_limit_error';
    message: string;
}

// ApiResponse is a "discriminated union" based on the 'status' property.
export type ApiResponse = SuccessResponse | ErrorResponse | RateLimitErrorResponse;

export interface CacheEntry {
  data: ApiResponse;
  timestamp: number;
}