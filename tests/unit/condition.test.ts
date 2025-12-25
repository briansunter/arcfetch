const score = 85;
const isValid = true;
const usePlaywright = false;
const noFallback = false;

const condition1 = !usePlaywright && !noFallback && (!isValid || score < 85);
const condition2 = !usePlaywright && !noFallback && (!isValid || score <= 85);

console.log('Score:', score);
console.log('Is Valid:', isValid);
console.log('Condition with < 85:', condition1);  // false
console.log('Condition with <= 85:', condition2); // true
