import { describe, expect, test } from 'bun:test';
import { extractLinksFromMarkdown } from '../../src/utils/markdown-links';

describe('extractLinksFromMarkdown', () => {
  describe('explicit markdown links (unchanged behavior)', () => {
    test('extracts a basic explicit link', () => {
      expect(extractLinksFromMarkdown('[Google](https://google.com)')).toEqual([
        { text: 'Google', href: 'https://google.com' },
      ]);
    });

    test('preserves titles, nested parentheses, and angle destinations', () => {
      const md = `[With title](https://example.com/page "Example")
[With parens](https://example.com/a_(b))
[Angle](<https://example.com/angle?q=(x)>)`;
      expect(extractLinksFromMarkdown(md)).toEqual([
        { text: 'With title', href: 'https://example.com/page' },
        { text: 'With parens', href: 'https://example.com/a_(b)' },
        { text: 'Angle', href: 'https://example.com/angle?q=(x)' },
      ]);
    });

    test('handles escaped brackets in link text', () => {
      expect(extractLinksFromMarkdown('[a\\]b](https://example.com/x)')).toEqual([
        { text: 'a\\]b', href: 'https://example.com/x' },
      ]);
    });

    test('ignores images', () => {
      const md = `![Logo](https://example.com/logo.png)
[Real](https://example.com/real)`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'Real', href: 'https://example.com/real' }]);
    });
  });

  describe('interleaved source order across forms', () => {
    test('emits explicit, angle, and bare links in source order', () => {
      const md = `First [Explicit](https://example.com/a) then
<https://example.com/b> and finally
bare https://example.com/c here.`;
      expect(extractLinksFromMarkdown(md)).toEqual([
        { text: 'Explicit', href: 'https://example.com/a' },
        { text: 'https://example.com/b', href: 'https://example.com/b' },
        { text: 'https://example.com/c', href: 'https://example.com/c' },
      ]);
    });

    test('bare url between two explicit links keeps order', () => {
      const md = '[A](https://example.com/a) see https://example.com/b and [C](https://example.com/c)';
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]);
    });
  });

  describe('deduplication across forms', () => {
    test('duplicate href across explicit, angle, and bare keeps first occurrence and text', () => {
      const md = `[First](https://example.com/x)
<https://example.com/x>
https://example.com/x`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'First', href: 'https://example.com/x' }]);
    });

    test('angle first wins over later explicit and bare', () => {
      const md = `<https://example.com/x>
[Later](https://example.com/x)
https://example.com/x`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'https://example.com/x', href: 'https://example.com/x' }]);
    });
  });

  describe('code spans and fenced code', () => {
    test('ignores bare and angle urls inside fenced code blocks', () => {
      const md = [
        'Text https://example.com/keep',
        '',
        '```js',
        'const u = "https://example.com/skip";',
        '<https://example.com/skip2>',
        '```',
        '',
        'More https://example.com/keep2',
      ].join('\n');
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/keep',
        'https://example.com/keep2',
      ]);
    });

    test('ignores urls inside inline code spans', () => {
      const md =
        'See `https://example.com/skip` and `code <https://example.com/skip2> end` then https://example.com/keep';
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual(['https://example.com/keep']);
    });

    test('tilde fences are also skipped', () => {
      const md = [
        'https://example.com/keep',
        '~~~',
        'https://example.com/skip',
        '~~~',
        'https://example.com/keep2',
      ].join('\n');
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/keep',
        'https://example.com/keep2',
      ]);
    });
  });

  describe('images and existing link text/destinations', () => {
    test('does not harvest bare url from link text, only the destination', () => {
      const md = '[Visit https://example.com/text now](https://example.com/dest)';
      expect(extractLinksFromMarkdown(md)).toEqual([
        { text: 'Visit https://example.com/text now', href: 'https://example.com/dest' },
      ]);
    });

    test('does not extract image destination as a link', () => {
      const md = '![alt text](https://example.com/image.png) and [link](https://example.com/link)';
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'link', href: 'https://example.com/link' }]);
    });

    test('does not double-extract an explicit destination as a bare url', () => {
      expect(extractLinksFromMarkdown('[Only](https://example.com/once)')).toEqual([
        { text: 'Only', href: 'https://example.com/once' },
      ]);
    });
  });

  describe('bare url trailing punctuation', () => {
    test('trims ordinary trailing sentence punctuation', () => {
      const cases: Array<[string, string]> = [
        ['https://example.com/page.', 'https://example.com/page'],
        ['See https://example.com/page,', 'https://example.com/page'],
        ['Visit https://example.com/page!', 'https://example.com/page'],
        ['Did you visit https://example.com/page?', 'https://example.com/page'],
      ];
      for (const [input, expected] of cases) {
        expect(extractLinksFromMarkdown(input).map((l) => l.href)).toEqual([expected]);
      }
    });

    test('preserves balanced parentheses', () => {
      expect(extractLinksFromMarkdown('See https://en.wikipedia.org/wiki/Foo_(bar).').map((l) => l.href)).toEqual([
        'https://en.wikipedia.org/wiki/Foo_(bar)',
      ]);
    });

    test('strips an unbalanced trailing closing paren', () => {
      expect(extractLinksFromMarkdown('(see https://example.com/page).').map((l) => l.href)).toEqual([
        'https://example.com/page',
      ]);
    });

    test('preserves query strings and trims trailing punctuation after them', () => {
      expect(extractLinksFromMarkdown('Go https://example.com/page?q=1&r=2.').map((l) => l.href)).toEqual([
        'https://example.com/page?q=1&r=2',
      ]);
    });
  });

  describe('non-http/https and malformed candidates', () => {
    test('ignores mailto, ftp, anchors, relative paths, and bare www', () => {
      const md = `[Mail](mailto:a@b.com)
[FTP](ftp://host.com)
[Anchor](#section)
[Relative](./file.md)
www.example.com
[Real](https://example.com/real)`;
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual(['https://example.com/real']);
    });

    test('ignores angle autolinks that are not http/https', () => {
      const md = `<mailto:a@b.com>
<ftp://host.com>
<not-a-url>
<https://example.com/keep>`;
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual(['https://example.com/keep']);
    });

    test('ignores a bare https glued to a preceding word', () => {
      expect(extractLinksFromMarkdown('foohttps://example.com/x')).toEqual([]);
    });
  });

  describe('reference-style links', () => {
    test('resolves full reference links [text][label]', () => {
      const md = `[docs]: https://example.com/docs
See [the docs][docs].`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'the docs', href: 'https://example.com/docs' }]);
    });

    test('resolves collapsed reference links [label][]', () => {
      const md = `[docs]: https://example.com/docs
See [docs][].`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'docs', href: 'https://example.com/docs' }]);
    });

    test('resolves shortcut reference links [label]', () => {
      const md = `[docs]: https://example.com/docs
See [docs].`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'docs', href: 'https://example.com/docs' }]);
    });

    test('spec example: three forms resolve, dedup by href, first text wins', () => {
      const md = `[docs]: https://example.com/docs
See [the docs][docs], [docs][] and [docs].`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'the docs', href: 'https://example.com/docs' }]);
    });

    test('definition can appear after its references', () => {
      const md = `See [later][ref] then [ref].
[ref]: https://example.com/ref`;
      // Forward resolution works; the second reference deduplicates against the first.
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'later', href: 'https://example.com/ref' }]);
    });

    test('label matching is case-insensitive', () => {
      const md = `[Docs]: https://example.com/docs
[see][docs] and [DOCS][] and [DoCs]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'see', href: 'https://example.com/docs' }]);
    });

    test('label matching normalizes internal whitespace (spaces, tabs, newlines)', () => {
      const md = `[my\tlabel]: https://example.com/x
[click here][my label]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'click here', href: 'https://example.com/x' }]);
    });

    test('label can span lines and still match a single-line reference', () => {
      const md = `[my
label]: https://example.com/x
[go][my label]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'go', href: 'https://example.com/x' }]);
    });

    test('reference link text is preserved exactly as written', () => {
      const md = `[lab1]: https://example.com/a
[Mixed]: https://example.com/b
[kebab-case]: https://example.com/c
[UPPER Text][lab1] then [Mixed][] then [kebab-case]`;
      expect(extractLinksFromMarkdown(md)).toEqual([
        { text: 'UPPER Text', href: 'https://example.com/a' },
        { text: 'Mixed', href: 'https://example.com/b' },
        { text: 'kebab-case', href: 'https://example.com/c' },
      ]);
    });

    test('up to three leading spaces are allowed on a definition', () => {
      const md = `   [x]: https://example.com/x
[x]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'x', href: 'https://example.com/x' }]);
    });
  });

  describe('reference definitions and bare-url harvesting', () => {
    test('definition destination is not harvested as a bare link', () => {
      const md = `[only]: https://example.com/only
[only]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'only', href: 'https://example.com/only' }]);
    });

    test('a definition line and its reference do not double-emit', () => {
      const md = `[a]: https://example.com/a
[a][a]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'a', href: 'https://example.com/a' }]);
    });

    test('duplicate definitions keep the first destination', () => {
      const md = `[a]: https://example.com/first
[a]: https://example.com/second
[a]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'a', href: 'https://example.com/first' }]);
    });

    test('an invalid definition (trailing prose) does not suppress a bare url', () => {
      const md = `[prose]: see https://example.com/prose here
[prose]`;
      expect(extractLinksFromMarkdown(md)).toEqual([
        { text: 'https://example.com/prose', href: 'https://example.com/prose' },
      ]);
    });

    test('supports angle-bracket destinations and optional titles', () => {
      const md = `[a]: <https://example.com/a> "Title A"
[b]: https://example.com/b 'Title B'
[c]: https://example.com/c (Title C)
[a] [b] [c]`;
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ]);
    });

    test('ignores definitions and references with non-http destinations', () => {
      const md = `[mail]: mailto:a@b.com
[ftp]: ftp://host.com
[mail] and [ftp]`;
      expect(extractLinksFromMarkdown(md)).toEqual([]);
    });
  });

  describe('reference ordering, dedup, and exclusion', () => {
    test('reference links interleave with inline/bare/angle in source order', () => {
      const md = `[r]: https://example.com/r
[ref][r] then [inline](https://example.com/i) then
<https://example.com/a> and bare https://example.com/b`;
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/r',
        'https://example.com/i',
        'https://example.com/a',
        'https://example.com/b',
      ]);
    });

    test('deduplicates a reference against a later bare url, keeping first text', () => {
      const md = `[r]: https://example.com/x
[link][r] and https://example.com/x`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'link', href: 'https://example.com/x' }]);
    });

    test('ignores reference definitions inside fenced code blocks', () => {
      const md = ['```', '[skip]: https://example.com/skip', '```', '[real]: https://example.com/real', '[real]'].join(
        '\n'
      );
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'real', href: 'https://example.com/real' }]);
    });

    test('ignores reference links and definitions inside inline code', () => {
      const md = '`[x]: https://example.com/x` then `[x]` then [x]';
      expect(extractLinksFromMarkdown(md)).toEqual([]);
    });

    test('ignores reference-style images in all forms', () => {
      const md = `[pic]: https://example.com/pic.png
![alt][pic] ![alt][] ![alt] and [pic]`;
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'pic', href: 'https://example.com/pic.png' }]);
    });

    test('unresolved references and ordinary [text] are not treated as links', () => {
      const md = `[undef][nope] and [nope][] and [nope]
plus [ordinary unmatched text] here.`;
      expect(extractLinksFromMarkdown(md)).toEqual([]);
    });

    test('a full reference whose label is undefined falls through (no link)', () => {
      const md = `[ok]: https://example.com/ok
[used as text][missing]`;
      expect(extractLinksFromMarkdown(md)).toEqual([]);
    });
  });

  describe('base-URL relative resolution', () => {
    test('without a base, relative destinations stay ignored (no-base compatibility)', () => {
      const md = '[a](/root) [b](./rel) [c](../up) [d](?q=1) [e](//host/x) [ok](https://keep.com/a)';
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'ok', href: 'https://keep.com/a' }]);
    });

    test('an omitted, malformed, or non-http base disables resolution', () => {
      const md = '[a](/page)';
      expect(extractLinksFromMarkdown(md)).toEqual([]);
      expect(extractLinksFromMarkdown(md, 'not-a-url')).toEqual([]);
      expect(extractLinksFromMarkdown(md, 'mailto:x@y.com')).toEqual([]);
      expect(extractLinksFromMarkdown(md, 'ftp://host.com')).toEqual([]);
      expect(extractLinksFromMarkdown(md, '')).toEqual([]);
      // An absolute link still resolves without a usable base.
      expect(extractLinksFromMarkdown('[ok](https://keep.com/a)', 'not-a-url')).toEqual([
        { text: 'ok', href: 'https://keep.com/a' },
      ]);
    });

    test('resolves root-relative, relative, and parent-relative destinations', () => {
      const md = '[root](/page) [rel](./next) [up](../prev)';
      expect(extractLinksFromMarkdown(md, 'https://example.com/a/b')).toEqual([
        { text: 'root', href: 'https://example.com/page' },
        { text: 'rel', href: 'https://example.com/a/next' },
        { text: 'up', href: 'https://example.com/prev' },
      ]);
    });

    test('resolves query-only destinations against the base path', () => {
      expect(extractLinksFromMarkdown('[q](?page=2)', 'https://example.com/list')).toEqual([
        { text: 'q', href: 'https://example.com/list?page=2' },
      ]);
    });

    test('resolves protocol-relative destinations', () => {
      expect(extractLinksFromMarkdown('[cdn](//cdn.example.com/x)', 'https://example.com/article')).toEqual([
        { text: 'cdn', href: 'https://cdn.example.com/x' },
      ]);
    });

    test('keeps already-absolute http(s) destinations verbatim, never rewritten', () => {
      expect(extractLinksFromMarkdown('[a](https://other.com/x)', 'https://example.com/article')).toEqual([
        { text: 'a', href: 'https://other.com/x' },
      ]);
    });

    test('rejects fragment-only, mailto, ftp, javascript, and data destinations even with a base', () => {
      const md = `[frag](#section)
[mail](mailto:a@b.com)
[ftp](ftp://host.com)
[js](javascript:void(0))
[data](data:text/plain,hi)
[ok](/page)`;
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'ok', href: 'https://example.com/page' },
      ]);
    });

    test('deduplicates an absolute and equivalent relative link, keeping the first occurrence', () => {
      const md = '[abs](https://example.com/page) then [rel](/page)';
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'abs', href: 'https://example.com/page' },
      ]);
    });

    test('a relative link first wins over an equivalent later absolute link', () => {
      const md = '[rel](/page) then [abs](https://example.com/page)';
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'rel', href: 'https://example.com/page' },
      ]);
    });

    test('bare prose URLs stay absolute and dedup against an equivalent relative link', () => {
      const md = '[rel](/page) and bare https://example.com/page';
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'rel', href: 'https://example.com/page' },
      ]);
    });

    test('resolves relative reference-definition destinations against the base', () => {
      const md = `[ref]: /page
See [ref], [ref][], and [the ref][ref].`;
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'ref', href: 'https://example.com/page' },
      ]);
    });

    test('keeps an absolute reference-definition destination verbatim with a base', () => {
      const md = `[ref]: https://other.com/x
[ref]`;
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'ref', href: 'https://other.com/x' },
      ]);
    });

    test('a reference definition with a non-http destination stays ignored with a base', () => {
      const md = `[mail]: mailto:a@b.com
[mail]`;
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([]);
    });
  });

  describe('canonical HTTP(S) deduplication', () => {
    test('collapses host case, default port, and fragment between absolute and base-relative', () => {
      // https://EXAMPLE.com:443/page#section canonicalizes (host lowercased, :443
      // dropped, fragment removed) to the same identity as /page resolved against
      // https://example.com/article -> https://example.com/page. The first
      // occurrence's href stays verbatim, fragment and all.
      const md = '[abs](https://EXAMPLE.com:443/page#section) then [rel](/page)';
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'abs', href: 'https://EXAMPLE.com:443/page#section' },
      ]);
    });

    test('first occurrence wins in either order (base-relative form)', () => {
      const md = '[rel](/page) then [abs](https://EXAMPLE.com:443/page#section)';
      expect(extractLinksFromMarkdown(md, 'https://example.com/article')).toEqual([
        { text: 'rel', href: 'https://example.com/page' },
      ]);
    });

    test('collapses default ports on absolute-only http links', () => {
      const md = '[port](http://example.com:80/page) and [plain](http://example.com/page)';
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'port', href: 'http://example.com:80/page' }]);
    });

    test('collapses empty path and trailing slash on absolute links', () => {
      const md = '[bare](https://example.com) and [slash](https://example.com/)';
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'bare', href: 'https://example.com' }]);
    });

    test('first occurrence wins in either order (absolute-only form)', () => {
      const md = '[slash](https://example.com/) then [bare](https://example.com)';
      expect(extractLinksFromMarkdown(md)).toEqual([{ text: 'slash', href: 'https://example.com/' }]);
    });

    test('collapses only the fragment, keeping different paths distinct', () => {
      const md = '[a](https://example.com/page#one) and [b](https://example.com/other#two)';
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/page#one',
        'https://example.com/other#two',
      ]);
    });

    test('preserves query ordering as a distinction', () => {
      const md = '[ab](https://example.com/p?a=1&b=2) and [ba](https://example.com/p?b=2&a=1)';
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/p?a=1&b=2',
        'https://example.com/p?b=2&a=1',
      ]);
    });

    test('preserves path case as a distinction', () => {
      const md = '[cap](https://example.com/Page) and [low](https://example.com/page)';
      expect(extractLinksFromMarkdown(md).map((l) => l.href)).toEqual([
        'https://example.com/Page',
        'https://example.com/page',
      ]);
    });
  });
});
