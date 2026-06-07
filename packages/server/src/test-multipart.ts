type FilePart = { field: string; filename: string; data: Buffer };
type FieldPart = { field: string; value: string };
type Part = FilePart | FieldPart;

/** Build a multipart/form-data body for app.inject in tests (file parts and/or text field parts). */
export async function multipart(parts: Part[]) {
  const boundary = "----asboundary";
  const chunks: Buffer[] = [];
  for (const p of parts) {
    if ("data" in p) {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"; filename="${p.filename}"\r\n` +
        `Content-Type: application/json\r\n\r\n`));
      chunks.push(p.data);
      chunks.push(Buffer.from("\r\n"));
    } else {
      chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${p.field}"\r\n\r\n${p.value}\r\n`));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
