import { chromium, type Browser } from 'playwright';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PlaywrightConfig } from '../../config/schema.js';
import type { BrowserManager } from './types.js';

const execAsync = promisify(exec);

let containerId: string | null = null;
let browserInstance: Browser | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync('docker info', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function pullDockerImage(image: string): Promise<void> {
  try {
    // Check if image exists locally first
    await execAsync(`docker image inspect ${image}`, { timeout: 10000 });
  } catch {
    // Image doesn't exist, pull it
    console.error(`Pulling Docker image: ${image}...`);
    await execAsync(`docker pull ${image}`, { timeout: 300000 }); // 5 min timeout for pull
  }
}

export class DockerBrowserManager implements BrowserManager {
  private config: PlaywrightConfig;
  private wsEndpoint: string | null = null;
  
  constructor(config: PlaywrightConfig) {
    this.config = config;
  }
  
  async getBrowser(): Promise<Browser> {
    if (browserInstance) {
      return browserInstance;
    }
    
    // Pull image if needed
    await pullDockerImage(this.config.dockerImage);
    
    // Find available port
    const port = await this.findAvailablePort();
    
    // Start container with Playwright server
    const { stdout } = await execAsync(`
      docker run -d --rm \
        -p ${port}:3000 \
        --name sofetch-playwright-${port} \
        ${this.config.dockerImage} \
        npx -y playwright run-server --port 3000
    `.trim());
    
    containerId = stdout.trim();
    this.wsEndpoint = `ws://localhost:${port}`;
    
    // Wait for server to be ready
    await this.waitForServer(port);
    
    // Connect to browser
    browserInstance = await chromium.connect(this.wsEndpoint);
    
    return browserInstance;
  }
  
  async closeBrowser(): Promise<void> {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
    
    if (containerId) {
      try {
        await execAsync(`docker stop ${containerId}`, { timeout: 10000 });
      } catch {
        // Container may have already stopped
      }
      containerId = null;
    }
  }
  
  isDocker(): boolean {
    return true;
  }
  
  private async findAvailablePort(): Promise<number> {
    // Start from 3001 and find an available port
    for (let port = 3001; port < 3100; port++) {
      try {
        const server = Bun.serve({
          port,
          fetch() { return new Response(''); }
        });
        server.stop();
        return port;
      } catch {
      }
    }
    throw new Error('No available ports found');
  }
  
  private async waitForServer(port: number, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://localhost:${port}/json`);
        if (response.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Playwright server failed to start');
  }
}

// Cleanup on process exit
process.on('exit', async () => {
  if (containerId) {
    try {
      await execAsync(`docker stop ${containerId}`);
    } catch {}
  }
});

process.on('SIGINT', async () => {
  if (containerId) {
    try {
      await execAsync(`docker stop ${containerId}`);
    } catch {}
  }
  process.exit();
});
