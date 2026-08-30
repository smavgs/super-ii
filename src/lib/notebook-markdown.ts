import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });
markdown.disable('image');

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, renderer) => renderer.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('rel', 'nofollow noreferrer');
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('referrerpolicy', 'no-referrer');
  return defaultLinkOpen(tokens, index, options, environment, renderer);
};

export function renderNotebookMarkdown(source: string): string {
  return markdown.render(source.slice(0, 250_000));
}
