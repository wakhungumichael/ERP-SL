/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
export async function downloadDocumentPdf(response: Response, filename: string) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
    throw new Error('Unable to generate the PDF. Please try again.');
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
