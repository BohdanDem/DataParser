import { Injectable, OnModuleDestroy } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface Catalog {
  title: string;
  link: string;
  validFrom: string;
  validUntil: string;
  localPath?: string;
}

@Injectable()
export class ParserService implements OnModuleDestroy {
  private browser: puppeteer.Browser | null = null;
  private readonly downloadPath = path.join(process.cwd(), 'data');

  constructor() {
    this.createDirectories();
    this.initBrowser();
  }

  private async initBrowser() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  private createDirectories(): void {
    if (!fs.existsSync(this.downloadPath)) {
      try {
        fs.mkdirSync(this.downloadPath, { recursive: true });
        console.log(`Created directory: ${this.downloadPath}`);
      } catch (error) {
        console.error(`Error creating directory ${this.downloadPath}:`, error);
      }
    }

    const catalogsPath = path.join(this.downloadPath, 'catalogs');
    if (!fs.existsSync(catalogsPath)) {
      try {
        fs.mkdirSync(catalogsPath, { recursive: true });
        console.log(`Created directory: ${catalogsPath}`);
      } catch (error) {
        console.error(`Error creating directory ${catalogsPath}:`, error);
      }
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async parseCatalogs() {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();
    await page.goto('https://www.tus.si/#s2', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });
    
    await page.waitForSelector('.card-catalogue', { timeout: 60000 });

    const catalogs = await page.evaluate(() => {
      const catalogItems = document.querySelectorAll('.card-catalogue');
      return Array.from(catalogItems).map(item => {
        const link = item.querySelector('a[href*=".pdf"]')?.getAttribute('href') || '';
        const title = item.querySelector('h3 a')?.textContent?.trim() || '';
        const dateElement = item.querySelector('p');
        
        const startDate = dateElement?.querySelector('time:first-child')?.getAttribute('datetime') || '';
        const endDate = dateElement?.querySelector('time:last-child')?.getAttribute('datetime') || '';
        
        return {
          title,
          link,
          validFrom: startDate,
          validUntil: endDate
        };
      }).filter(catalog => catalog.link);
    });

    await page.close();
    
    await this.processCatalogs(catalogs);
    
    return catalogs;
  }

  private async processCatalogs(catalogs: Catalog[]): Promise<void> {
    console.log(`Found ${catalogs.length} catalogs to download`);
    
    const downloadPromises = catalogs.map(catalog => this.downloadCatalog(catalog));
    await Promise.all(downloadPromises);

    const metadataPath = path.join(this.downloadPath, 'catalogs_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(catalogs, null, 2));
    console.log(`Metadata saved to: ${metadataPath}`);
    
    console.log('Parsing is complete. Check the data/catalogs folder for the results.');
  }

  private async downloadCatalog(catalog: Catalog): Promise<void> {
    if (!catalog.link) {
      console.warn(`No download link for catalog: ${catalog.title}`);
      return;
    }

    const fileName = this.createSafeFileName(catalog.title);
    const filePath = path.join(this.downloadPath, 'catalogs', fileName);

    const catalogsDir = path.dirname(filePath);
    if (!fs.existsSync(catalogsDir)) {
      try {
        fs.mkdirSync(catalogsDir, { recursive: true });
        console.log(`Created directory: ${catalogsDir}`);
      } catch (error) {
        console.error(`Error creating directory ${catalogsDir}:`, error);
        throw error;
      }
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(filePath);
      
      https.get(catalog.link, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download ${catalog.title}: ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          catalog.localPath = filePath;
          console.log(`Downloaded: ${catalog.title} to ${filePath}`);
          file.close();
          resolve();
        });

        file.on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      }).on('error', (err) => {
        fs.unlink(filePath, () => {});
        reject(err);
      });
    });
  }

  private createSafeFileName(title: string): string {
    const safeTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9]/gi, '_')
      .replace(/_+/g, '_')
      .trim();
    
    return `${safeTitle}_${Date.now()}.pdf`;
  }
}
