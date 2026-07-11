export type DownloadFile = (serialized: string, filename: string) => void;

export const downloadJsonFile: DownloadFile = (serialized, filename) => {
  const blob = new Blob([serialized], { type: 'application/json;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.download = filename;
  anchor.href = objectUrl;
  anchor.hidden = true;
  anchor.rel = 'noopener';
  document.body.append(anchor);

  try {
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
};
