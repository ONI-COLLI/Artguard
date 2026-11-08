import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of error.issues) fields[issue.path.join('.')] = issue.message;
    res.status(400).json({ error: 'Check the highlighted fields.', fields });
    return;
  }
  if (error instanceof MulterError) {
    res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Choose an image no larger than 20 MB.'
          : 'Invalid upload. Use one original image and up to 7 additional photos.',
    });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON request.' });
    return;
  }
  if ((error as { code?: string })?.code?.includes('CONSTRAINT')) {
    res.status(409).json({ error: 'This record already exists. Please refresh and try again.' });
    return;
  }
  if ((error as { status?: number })?.status === 413) {
    res.status(413).json({ error: 'The request is too large.' });
    return;
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
};
