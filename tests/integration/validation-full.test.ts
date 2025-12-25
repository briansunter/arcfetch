import { validateMarkdown, formatValidationReport } from './markdown-validator';

const testMarkdown = `The heart of the internet

Log In

Log in to Reddit`;

const result = validateMarkdown(testMarkdown);
console.log('Score:', result.score);
console.log('Is Valid:', result.isValid);
console.log('\nReport:');
console.log(formatValidationReport(result));
