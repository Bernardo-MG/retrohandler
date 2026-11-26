/** A write operation, independent of the kind of file shown in the preview. */
export type FileOperation = {
  relativeDestination: string;
  content: { file: string } | { bytes: Buffer };
  maxBytes: number;
  size: number;
  action: 'create' | 'update' | 'reuse';
  previous: string | null;
  output: string;
};

export type FileOperationReceipt = {
  copied: number;
  backups?: string[];
};
