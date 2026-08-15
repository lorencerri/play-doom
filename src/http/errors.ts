// Domain code throws these; the route wrapper in app.ts turns them into responses.
// Anything else that escapes a handler is a bug and becomes a logged 500.
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = 'HttpError';
	}
}

export function badRequest(message: string): HttpError {
	return new HttpError(400, message);
}

export function notFoundError(message: string): HttpError {
	return new HttpError(404, message);
}
