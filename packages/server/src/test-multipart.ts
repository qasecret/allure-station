/** Build a multipart/form-data body for app.inject in tests. */
export async function multipart(files: { field: string; filename: string; data: Buffer }[]) {
  const boundary = "----asboundary";
  const chunks: Buffer[] = [];
  for (const f of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\n` +
      `Content-Type: application/json\r\n\r\n`));
    chunks.push(f.data);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
