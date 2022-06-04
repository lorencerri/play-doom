import { BadRequestException, Injectable, InternalServerErrorException, StreamableFile } from '@nestjs/common';
import { UltimateTextToImage } from 'ultimate-text-to-image';
import { exec } from 'child_process';
import { createReadStream, promises as fs } from 'fs';
import { QuickDB } from 'quick.db';

const db = new QuickDB();
const dataDir = './data';

export interface HttpRange {
	start: number;
	end?: number;
}

export interface StreamRange {
	start: number;
	end: number;
}

@Injectable()
export class AppService {
	async getInput(namespace: string): Promise<string[]> {
		const input: string[] = await db.get(`input_${namespace}`) || [];
		if (input.length === 0) return ['x,'];
		else if (input[0] != 'x,') return ['x,'].concat(input);
		else return input;
	}

	validateFiletype(type: string): void {
		if (!['png', 'gif'].includes(type)) throw new BadRequestException("query.type is invalid")
	}

	validateNamespace(namespace: string): void {
		if (namespace.length === 0) throw new BadRequestException("query.namespace cannot be empty.")
		if (namespace.length > 32) throw new BadRequestException("query.namespace cannot be longer than 32 characters.")
		if (!/^[a-zA-Z0-9_]+$/.test(namespace)) throw new BadRequestException("Invalid characters in query.namespace.")
	}

	validateInput(input: string): void {
		if (input.length === 0) throw new BadRequestException("query.keys cannot be empty.");
		if (input.length > 1024) throw new BadRequestException("query.keys cannot be longer than 1024 characters.");
		if (!/^[,xelrudaspftynUDLRjk2-7]+$/.test(input)) throw new BadRequestException("Invalid characters in query.keys.");
	}

	getReplayExecString(nrecord = 1, nthframe = 1, framerate = 35, outputFile: string, input = ','): string {
		return './doomreplay/doomgeneric/doomgeneric' +
			' -iwad ./doomreplay/doom1.wad' +
			` -nrecord ${nrecord}` +
			` -nthframe ${nthframe}` +
			` -framerate ${framerate}` +
			' -render_frame' +
			` -output ${outputFile}` +
			` -input ${input}`
	}

	async execWithCallback(execStr = ""): Promise<string> {
		if (execStr.length === 0) throw new InternalServerErrorException("execStr cannot be empty.");
		return new Promise((resolve, reject) => {
			const process = exec(execStr);

			process.stderr.on('data', console.log);
			process.stdout.on('data', console.log);
			process.on('exit', () => resolve(""));
			process.on('close', () => resolve(""));
			process.on('error', (err) => resolve(err.message));
		})
	}

	getUncachedHeader(contentType: string, filename: string, attachment = true, merge = {}): any {
		return {
			'Content-Type': contentType,
			'Content-Disposition': `${attachment ? 'attachment;' : ''} filename="${filename}"`,
			'Cache-Control': 'no-cache,max-age=0',
			'Expires': 'Sun, 06 Jul 2014 07:27:43 GMT',
			...merge
		}
	}

	parseRangeHeader(header?: string): HttpRange[] | undefined {
		if (header === undefined || !header.startsWith("bytes=")) return undefined;
		const ranges = header.replace("bytes=", "").split(",")
			.map((range): HttpRange => {
				if (!range.includes("-")) {
					const start = this.parseRangePart(range);
					if (start === undefined) return undefined;
					return { start };
				}
				const [startRaw, endRaw] = range.split("-");
				const start = this.parseRangePart(startRaw);
				const end = this.parseRangePart(endRaw);
				if (start === undefined || (end !== undefined && start > end)) return undefined;
				return { start, end };
			});
		const includesNonZeroRange = ranges.some(({ start, end }) => (end === undefined || start !== end));
		if (!includesNonZeroRange) return undefined;
		return ranges;
	}

	calculateStreamRange(size: number, httpRange: HttpRange): StreamRange {
		const lastByte = size - 1;
		const start = httpRange.start >= lastByte ? lastByte : httpRange.start;
		const chunkSize = Math.min(500000, lastByte - start, (httpRange.end ?? lastByte) - start);
		const end = start + chunkSize;
		return { start, end };
	}

	parseRangePart(raw?: string): number | undefined {
		if (raw === undefined) return;
		const parsed = parseInt(raw, 10);
		if (isNaN(parsed)) return;
		return parsed;
	}

	async streamVideoWithOptionalRange(filePath: string, res: any, range: any) {
		const file = await fs.readFile(filePath);
		const httpRanges = this.parseRangeHeader(range);
		const streamRange = httpRanges && this.calculateStreamRange(file.byteLength, httpRanges[0]);
		const readStream = createReadStream(filePath, streamRange);
		const fileName = filePath.split('/').pop();

		if (streamRange) {
			res.status(206).set(this.getUncachedHeader('video/mp4', fileName, false, {
				"Content-Range": `bytes ${streamRange.start}-${streamRange.end}/${file.byteLength}`,
				"Accept-Ranges": "bytes",
				"Content-Length": streamRange.end - streamRange.start + 1,
			}));
			return new StreamableFile(readStream);
		}

		res.set(this.getUncachedHeader('video/mp4', fileName, false, {
			"Content-Length": file.byteLength,
			"Content-Type": "video/mp4"
		}));
		return new StreamableFile(readStream);
	}

	getImageFromText(input: string): UltimateTextToImage {
		return new UltimateTextToImage(input, {
			fontSize: 12,
			fontColor: '#C1C2C5',
			backgroundColor: '#1A1B1E',
			margin: 2,
			maxWidth: 1920 / 2,
		}).render();
	}

	normalizeInput(input: string | string[]): string {
		if (input instanceof Array) input = input.join('');

		const split = input
			.replace(/(?<=[xelrudaspftynUDLRjk2-7]),/g, '') // Removes all idles, if preceded by a different key
			.match(/([,xelrudaspftynUDLRjk2-7])\1*/g) || []; // Splits into groups of consecutive keys

		const repeating: [string, number][] = split.map((i) => [i.charAt(0), i.length]); // [ [key, length], [key, length], ... ]

		let output = [];
		for (const [key, length] of repeating) {
			output.push(`${this.convertKeyToName(key)}${length > 1 ? ` [x${length}]` : ''}`);
		}

		return output.join(', ');
	}

	async canAccessFile(path: string): Promise<boolean> {
		try {
			await fs.access(path);
			return true;
		} catch (e) { return false }
	}

	async generateVideo(namespace: string, input: string[], type: 'current' | 'full'): Promise<any> {
		const execStr = this.getReplayExecString(10000, 1, 35, `${dataDir}/${type}_${namespace}.mp4`, input.join(''));
		const err = await this.execWithCallback(execStr);
		if (err) throw new InternalServerErrorException(err);
	}

	convertKeyToName(key: string): string {
		const str: string = {
			',': 'Idle',
			'x': 'Escape',
			'e': 'Enter',
			'l': 'Left Arrow',
			'r': 'Right Arrow',
			'u': 'Up Arrow',
			'd': 'Down Arrow',
			'a': 'Alt',
			's': 'Shift',
			'p': 'Space',
			'f': 'Shoot',
			't': 'Toggle Map',
			'U': "Shift + Up Arrow",
			'D': "Shift + Down Arrow",
			'L': "Shift + Left Arrow",
			'R': "Shift + Right Arrow",
			'j': "Strafe Left",
			'k': "Strafe Right",
			'y': 'Yes',
			'n': 'No',
			'2': 'Item Slot 2',
			'3': 'Item Slot 3',
			'4': 'Item Slot 4',
			'5': 'Item Slot 5',
			'6': 'Item Slot 6',
			'7': 'Item Slot 7',
		}[key];

		return str || "Unknown";
	}
}
