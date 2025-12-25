import { validateMarkdown } from '../../src/utils/markdown-validator.js';

const testMarkdown = `# The heart of the internet

**URL:** https://www.reddit.com/r/MachineLearning/comments/1hq24iu/the_hidden_language_of_llms/

---

Log In

Log in to Reddit`;

const result = validateMarkdown(testMarkdown);
console.log('Score:', result.score);
console.log('Is Valid:', result.isValid);
console.log('Issues:', result.issues);
console.log('Warnings:', result.warnings);
