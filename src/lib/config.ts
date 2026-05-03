// Default profile values
export const DEFAULT_RAM = 16;
export const DEFAULT_CTX = 8192;
export const DEFAULT_QUANT_ID = 'q4_k_m';
export const DEFAULT_DEVICE_ID = 'apple-m3-pro';
export const DEFAULT_BW = 150;

// Memory bucket thresholds (as a fraction of ramGB).
// totalGB ≤ ramGB * BUCKET_FITS_THRESHOLD → fits comfortably
// totalGB ≤ ramGB                          → tight
// otherwise                                → over
export const BUCKET_FITS_THRESHOLD = 0.9;

// Default recommender constraints
export const DEFAULT_MIN_TPS = 10;
