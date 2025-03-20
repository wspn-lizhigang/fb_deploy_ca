/**
 * Format transaction hash, keeping the first 6 characters and last 4 characters, replacing the middle with ...
 * @param hash The complete transaction hash
 * @returns The formatted transaction hash
 */
export const formatTxHash = (hash: string): string => {
  if (!hash || hash.length < 10) return hash;
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
};