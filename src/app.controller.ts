import { BadRequestException, Controller, Get, InternalServerErrorException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import { QuickDB } from 'quick.db';
import { AppService } from './app.service';
import { promises as fs } from 'fs';
import { Md5 } from 'ts-md5/dist/md5';
import { Stats } from './types';

const db = new QuickDB();
const dataDir = './data';

@Controller()
export class AppController {
	constructor(private readonly appService: AppService) { }

	@Get()
	getHome(): string {
		return "https://github.com/lorencerri/play-doom";
	}

	@Get('/frame/:namespace')
	async getFrame(@Param('namespace') namespace = "", @Query('type') type = 'png', @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		if (type[0] === '.') type = type.substring(1);
		this.appService.validateFiletype(type);

		const input = await this.appService.getInput(namespace);

		const curHash = Md5.hashStr(input.join(''));
		const inputHash = await db.get(`inputHash_${namespace}`);

		if (curHash != inputHash) {
			const frameCount = type === 'png' ? 1 : Math.min(input[input.length - 1].length, 16);
			const nthframe = type === 'png' ? 1 : 2;
			const execStr = this.appService.getReplayExecString(frameCount, nthframe, 20, `${dataDir}/frame_${namespace}.${type}`, input.join(''));

			const err = await this.appService.execWithCallback(execStr);
			if (err) throw new InternalServerErrorException(err);

			await db.set(`inputHash_${namespace}`, curHash);
		}

		const file = await fs.readFile(`${dataDir}/frame_${namespace}.${type}`);

		res.set(this.appService.getUncachedHeader(`image/${type}`, `frame_${namespace}.${type}`));

		return new StreamableFile(file);
	}

	@Get('/input/:namespace')
	async getInput(@Param('namespace') namespace = "", @Query('image') img = false, @Query('readable') raw = false, @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		const input = await this.appService.getInput(namespace);

		if (!img) return raw ? input : this.appService.normalizeInput(input.join(''));

		const image = this.appService.getImageFromText(this.appService.normalizeInput(input.join('')));

		res.set(this.appService.getUncachedHeader('image/png', `input_${namespace}.png`));

		return new StreamableFile(image.toStream());
	}

	@Get('/input/:namespace/reset')
	async resetInput(@Param('namespace') namespace = "", @Query('callback') callback = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		/**
		 * TODO: Generate video, store file in a folder, store path in the database
		 * const input = await db.get(`input_${namespace}`);
		 * const rpath = this.appService.generateVideo(input);
		 * await db.push(`runs_${namespace}, rpath);
		 * const fpath = await this.appService.concatenateVideos(fullVideo, path);
		 * await db.set(`fullVideo_${namespace}`, fpath);
		 */

		await db.delete(`input_${namespace}`);

		if (callback.length != 0) return res.status(200).redirect(callback);
		res.status(200).send(`${namespace} reset`);
	}

	@Get('/input/:namespace/append')
	async appendInput(@Param('namespace') namespace = "", @Query('keys') keys = "", @Query('callback') callback = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);
		this.appService.validateInput(keys)

		await db.push(`input_${namespace}`, keys);


		if (callback.length != 0) res.status(200).redirect(callback);
		else res.status(200).send(`${keys} appended to ${namespace}`);

		await db.add(`stats.actions`, 1);
		await db.add(`stats.keysPressed`, keys.length);
	}

	@Get('/input/:namespace/rewind')
	async rewindInput(@Param('namespace') namespace = "", @Query('keys') keys = "", @Query('callback') callback = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		const input = await this.appService.getInput(namespace);
		if (input.length > 1) {
			input.pop();
			await db.set(`input_${namespace}`, input);
		}

		if (callback.length != 0) res.status(200).redirect(callback);
		else res.status(200).send(`${keys} appended to ${namespace}`);

		await db.add(`stats.rewinds`, 1);
	}

	@Get('/stats')
	async getStats(@Query('image') img = true, @Res({ passthrough: true }) res) {
		const stats: Stats = await db.get('stats');
		if (!img) return stats;

		const text = `\nActions: ${stats.actions || 0}\nRewinds: ${stats.rewinds || 0}\nKeys Pressed: ${stats.keysPressed || 0}`;

		const image = this.appService.getImageFromText(text);

		res.set(this.appService.getUncachedHeader('image/png', `stats.png`));

		return new StreamableFile(image.toStream());
	}
}
