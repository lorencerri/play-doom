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

		const input = await this.appService.getInput(namespace);
		await db.delete(`input_${namespace}`);
		await db.set(`currentVideoOutdated_${namespace}`, true);

		if (callback.length != 0) res.status(200).redirect(callback);
		else res.status(200).send(`${namespace} reset`);

		if (input.length > 1) {
			await this.appService.generateVideo(namespace, input, 'current');
			await db.set(`combinedOutdated_${namespace}`, true);

			const fullExists = await this.appService.canAccessFile(`${dataDir}/full_${namespace}.mp4`);

			if (fullExists) {
				await fs.writeFile(`${dataDir}/files.txt`, `file 'full_${namespace}.mp4'\nfile 'current_${namespace}.mp4'`, 'utf8');
				const execStr = `ffmpeg -f concat -i ${dataDir}/files.txt -y -safe 0 -c copy ${dataDir}/tmp_full_${namespace}.mp4`;
				const err = await this.appService.execWithCallback(execStr);
				if (err) throw new InternalServerErrorException(err);
				await db.set(`fullVideoOutdated_${namespace}`, false);
				await fs.rename(`${dataDir}/tmp_full_${namespace}.mp4`, `${dataDir}/full_${namespace}.mp4`);
			} else {
				await fs.rename(`${dataDir}/current_${namespace}.mp4`, `${dataDir}/full_${namespace}.mp4`);
			}
		}
	}

	@Get('/video/:namespace/current')
	async getCurrentVideo(@Param('namespace') namespace = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		const input = await this.appService.getInput(namespace);
		const outdated = await db.get(`currentVideoOutdated_${namespace}`);

		const exists = await this.appService.canAccessFile(`${dataDir}/current_${namespace}.mp4`)
		if (outdated || !exists) {
			await this.appService.generateVideo(namespace, input, 'current')
			await db.set(`currentVideoOutdated_${namespace}`, false);
		}

		const file = await fs.readFile(`${dataDir}/current_${namespace}.mp4`);
		res.set(this.appService.getUncachedHeader('video/mp4', `current_${namespace}.mp4`, false));
		return new StreamableFile(file);
	}

	@Get('/video/:namespace/full')
	async getFullVideo(@Param('namespace') namespace = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		const currentExists = await this.appService.canAccessFile(`${dataDir}/current_${namespace}.mp4`);
		const fullExists = await this.appService.canAccessFile(`${dataDir}/full_${namespace}.mp4`)
		const currentOutdated = await db.get(`currentVideoOutdated_${namespace}`);

		if (!currentExists || currentOutdated) {
			const input = await this.appService.getInput(namespace);
			await this.appService.generateVideo(namespace, input, 'current');
			await db.set(`currentVideoOutdated_${namespace}`, false);
		}

		if (!fullExists) {
			const file = await fs.readFile(`${dataDir}/current_${namespace}.mp4`);
			res.set(this.appService.getUncachedHeader('video/mp4', `current_${namespace}.mp4`, false));
			return new StreamableFile(file);
		}

		const file = await fs.readFile(`${dataDir}/full_${namespace}.mp4`);
		res.set(this.appService.getUncachedHeader('video/mp4', `full_${namespace}.mp4`, false));
		return new StreamableFile(file);
	}

	@Get('/video/:namespace/combined')
	async getCombinedVideo(@Param('namespace') namespace = "", @Res({ passthrough: true }) res) {
		this.appService.validateNamespace(namespace);

		const currentExists = await this.appService.canAccessFile(`${dataDir}/current_${namespace}.mp4`);
		const fullExists = await this.appService.canAccessFile(`${dataDir}/full_${namespace}.mp4`)
		const combinedExists = await this.appService.canAccessFile(`${dataDir}/combined_${namespace}.mp4`);
		const fullOutdated = await db.get(`fullVideoOutdated_${namespace}`);
		const currentOutdated = await db.get(`currentVideoOutdated_${namespace}`);
		const combinedOutdated = await db.get(`combinedOutdated_${namespace}`);

		if (!currentExists || currentOutdated) {
			const input = await this.appService.getInput(namespace);
			await this.appService.generateVideo(namespace, input, 'current');
			await db.set(`currentVideoOutdated_${namespace}`, false);
		}

		if (!fullExists || fullOutdated) {
			const file = await fs.readFile(`${dataDir}/current_${namespace}.mp4`);
			res.set(this.appService.getUncachedHeader('video/mp4', `current_${namespace}.mp4`, false));
			return new StreamableFile(file);
		}

		if (!combinedExists || combinedOutdated) {
			await fs.writeFile(`${dataDir}/files.txt`, `file 'full_${namespace}.mp4'\nfile 'current_${namespace}.mp4'`, 'utf8');
			const execStr = `ffmpeg -f concat -i ${dataDir}/files.txt -y -safe 0 -c copy ${dataDir}/combined_${namespace}.mp4`;
			const err = await this.appService.execWithCallback(execStr);
			if (err) throw new InternalServerErrorException(err);
			await db.set(`combinedOutdated_${namespace}`, false);
		}

		const file = await fs.readFile(`${dataDir}/combined_${namespace}.mp4`);
		res.set(this.appService.getUncachedHeader('video/mp4', `combined_${namespace}.mp4`, false));
		return new StreamableFile(file);
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
		await db.set(`currentVideoOutdated_${namespace}`, true);
		await db.set(`combinedOutdated_${namespace}`, true);
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
