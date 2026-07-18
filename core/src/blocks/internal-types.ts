// Internal to blocks/ — a raw detection hit before pills/fileCount/riskCount are attached.
// detect.ts turns these into real BlockNode[] (docs/architecture/DATA-MODEL.md); the three
// strategy modules only ever need to answer "what did I find, and where."
export type BlockCandidate = {
  name: string;
  /** POSIX-style, relative to rootDir, no leading/trailing slash. */
  path: string;
};
