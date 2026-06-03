import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

/**
 * Manual sidebar: the doc reads top-to-bottom as one cohesive technical
 * document, with the workflow-authoring chapters grouped under a "Workflows"
 * category. Order here is the source of truth (sidebar_position frontmatter is
 * not used for ordering when a manual sidebar is defined).
 */
const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'architecture',
    'executor-engine',
    {
      type: 'category',
      label: '4. Workflows',
      collapsed: false,
      items: [
        'building-workflows',
        'data-flow-references',
        'breakpoints-debugging',
      ],
    },
    'cli',
    'prism-morpheus-mcp',
    'live-example-dashboard',
    'ai-services',
    'design-discussions',
    'impact',
    'testimonials',
  ],
};

export default sidebars;
