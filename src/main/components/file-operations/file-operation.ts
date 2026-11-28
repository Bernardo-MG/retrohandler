/** A write operation, independent of the kind of file shown in the preview. */
export type FileOperation = {
  relativeDestination: string;
  content: { sourcePath: string } | { bytes: Buffer };
  maxBytes: number;
  size: number;
  action: 'create' | 'update' | 'reuse';
  previousHash: string | null;
  outputHash: string;
};

export type FileOperationReceipt = {
  copied: number;
  backups?: string[];
};
