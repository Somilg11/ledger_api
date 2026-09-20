import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Forwards rejected promises to the error middleware so a failed await can
 * never leave a request hanging.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as unknown as Req, res, next)).catch(next);
  };
}
