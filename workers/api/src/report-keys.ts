export const reportPrefix = (walkId: string): string => `reports/${walkId}/`;

export const approvalKey = (walkId: string): string => `${reportPrefix(walkId)}approval.json`;

export const pdfKey = (walkId: string): string => `${reportPrefix(walkId)}record.pdf`;

export const shareKey = (walkId: string): string => `${reportPrefix(walkId)}share.json`;

export const shareOffKey = (walkId: string): string => `${reportPrefix(walkId)}share-off.json`;

export const shareLookupKey = (token: string): string => `shares/${token}.json`;

export const shareTokensPrefix = (walkId: string): string => `${reportPrefix(walkId)}tokens/`;

export const shareTokenKey = (walkId: string, token: string): string => `${shareTokensPrefix(walkId)}${token}`;
