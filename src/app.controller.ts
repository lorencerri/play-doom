import { BadRequestException, Controller, Get, Param, Query, Res } from '@nestjs/common';
import { QuickDB } from 'quick.db';
import { AppService } from './app.service';

const db = new QuickDB();

@Controller()
export class AppController {
	constructor(private readonly appService: AppService) { }

	@Get()
	getHello(): string {
		return this.appService.getHello();
	}

	@Get('/input/:namespace/append')
	async appendInput(@Param('namespace') namespace = "", @Query('input') input = "", @Query('callback') callback = "", @Res({ passthrough: true }) res): Promise<any> {
		if (namespace.length === 0) throw new BadRequestException("Missing namespace")
		if (!this.appService.isValidInput(input)) throw new BadRequestException("Invalid input");

		await db.push(`input_${namespace}`, input);

		if (callback.length != 0) return res.status(200).redirect(callback);
		else return res.status(200).send(`${input} appended to ${namespace}`);
	}
}
