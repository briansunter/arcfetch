/**
 * Markdown Cleaning Utilities
 *
 * Post-processing functions to clean and optimize markdown for LLM context efficiency
 */

export function cleanMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  let cleaned = markdown

  cleaned = cleaned.replace(/\r\n/g, '\n')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  cleaned = cleaned.replace(/[ \t]+$/gm, '')
  cleaned = cleaned.trim()
  cleaned = cleaned.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2')
  cleaned = cleaned.replace(/(#{1,6} .+)\n([^#\n])/g, '$1\n\n$2')
  cleaned = cleaned.replace(/([^\n])\n([-*+] |\d+\. )/g, '$1\n\n$2')
  cleaned = cleaned.replace(/(\*|_) +/g, '$1')
  cleaned = cleaned.replace(/ +(\*|_)/g, '$1')
  cleaned = cleaned.replace(/([^\n])\n```/g, '$1\n\n```')
  cleaned = cleaned.replace(/```\n([^`])/g, '```\n\n$1')
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ' ')
  cleaned = cleaned.replace(/  +/g, ' ')

  return cleaned
}

export function advancedClean(markdown: string): string {
  let cleaned = markdown

  cleaned = cleaned.replace(/\[([^\]]+)\]\(\)/g, '$1')
  cleaned = cleaned.replace(/<[^>]+>/g, '')
  cleaned = cleaned.replace(/\*\*\*\*/g, '')
  cleaned = cleaned.replace(/(?<!\*)\*\*(?!\*)/g, '')
  cleaned = cleaned.replace(/__/g, '')
  cleaned = cleaned.replace(/!\[\]\(([^)]+)\)/g, '![]($1)')
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '')
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"')
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'")
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-')

  cleaned = cleaned.replace(/^(?!```)[^\n]*$/gm, (line) => {
    return line.replace(/  +/g, ' ')
  })

  return cleaned
}

export function finalCleanup(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  let cleaned = markdown

  cleaned = cleaned.replace(/^(\s*)[*+] /gm, '$1- ')
  cleaned = cleaned.replace(/_([^_]+)_/g, '*$1*')
  cleaned = cleaned.replace(/^~~~(\w*)\n/gm, '```$1\n')
  cleaned = cleaned.replace(/^~~~$/gm, '```')
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')
  cleaned = cleaned.trim() + '\n'

  return cleaned
}

export function cleanMarkdownComplete(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  let cleaned = cleanMarkdown(markdown)
  cleaned = advancedClean(cleaned)
  cleaned = finalCleanup(cleaned)

  return cleaned
}
