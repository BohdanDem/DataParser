import { Controller, Get } from '@nestjs/common';
import { ParserService } from './parser.service';

@Controller('parser')
export class ParserController {
  constructor(private readonly parserService: ParserService) {}
  
  @Get()
  async parseCatalogs(): Promise<string> {
    await this.parserService.parseCatalogs();
    return 'Parsing is complete. Check the data folder for the results.';
  }
}
