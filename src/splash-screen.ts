import figlet from 'figlet';
import gradient from 'gradient-string';
import boxen from 'boxen';
import chalk from 'chalk';
import { fs, path } from 'zx';

export const displaySplashScreen = async (): Promise<void> => {
  try {
    // Get version info from package.json
    const packagePath = path.join(import.meta.dirname, '..', 'package.json');
    const packageJson = (await fs.readJSON(packagePath)) as { version?: string };
    const version = packageJson.version || '1.0.0';

    // Create the main TESTICLES ASCII art using figlet
    const testiclesText = figlet.textSync('TESTICLES', {
      font: 'ANSI Shadow',
      horizontalLayout: 'default',
      verticalLayout: 'default',
    });

    // Apply gold/amber gradient to TESTICLES text
    const gradientTesticles = gradient(['#D4A017', '#F4C542', '#FFD700', '#FFA500'])(testiclesText);

    // Create tagline and version info
    const tagline = chalk.bold.white('AI User Acceptance Testing Framework');
    const versionInfo = chalk.gray(`v${version}`);
    const qualityBadge = chalk.bold.yellowBright('QUALITY ASSURANCE');

    // Build the complete splash content
    const content = [
      gradientTesticles,
      '',
      chalk.bold.cyan('             +=============================================+'),
      chalk.bold.cyan('             |') + '  ' + tagline + '  ' + chalk.bold.cyan('|'),
      chalk.bold.cyan('             +=============================================+'),
      '',
      `                          ${qualityBadge}`,
      '',
      `                              ${versionInfo}`,
      '',
    ].join('\n');

    // Create boxed output with styling
    const boxedContent = boxen(content, {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'yellow',
      dimBorder: false,
    });

    // Clear screen and display splash
    console.clear();
    console.log(boxedContent);

    // Add loading animation
    const loadingFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;

    return new Promise((resolve) => {
      const loadingInterval = setInterval(() => {
        process.stdout.write(
          `\r${chalk.yellow(loadingFrames[frameIndex]!)} ${chalk.dim('Initializing systems...')}`
        );
        frameIndex = (frameIndex + 1) % loadingFrames.length;
      }, 100);

      setTimeout(() => {
        clearInterval(loadingInterval);
        process.stdout.write(`\r${chalk.green('✓')} ${chalk.dim('Systems initialized.        ')}\n\n`);
        resolve();
      }, 2000);
    });
  } catch (error) {
    // Fallback to simple splash if anything fails
    const errMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.yellow.bold('\n  TESTICLES - AI User Acceptance Testing Framework\n'));
    console.log(chalk.gray('  Could not load full splash screen:', errMsg));
    console.log('');
  }
};
