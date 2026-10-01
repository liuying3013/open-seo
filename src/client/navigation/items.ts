import {
  Bookmark,
  CalendarCheck,
  BookOpen,
  Bot,
  Brain,
  ClipboardCheck,
  Compass,
  FileText,
  Files,
  Globe,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageSquare,
  Network,
  Search,
  Sparkles,
  Telescope,
  TrendingUp,
} from "lucide-react";
import { linkOptions } from "@tanstack/react-router";
import { GoogleGlyphMuted } from "@/client/features/gsc/GoogleGlyph";

const projectNavItems = [
  {
    to: "/p/$projectId" as const,
    label: "Dashboard",
    icon: LayoutDashboard,
    // Without exact matching, the index path is a prefix of every project
    // route and the Dashboard item would render active everywhere.
    activeOptions: { exact: true, includeSearch: false },
  },
  {
    to: "/p/$projectId/keywords" as const,
    label: "Keyword Research",
    icon: Search,
  },
  {
    to: "/p/$projectId/saved" as const,
    label: "Saved Keywords",
    icon: Bookmark,
  },
  {
    to: "/p/$projectId/candidate-keywords" as const,
    label: "Candidate Keywords",
    icon: ListChecks,
  },
  {
    to: "/p/$projectId/rank-tracking" as const,
    label: "Rank Tracking",
    icon: TrendingUp,
  },
  {
    to: "/p/$projectId/content-ops" as const,
    label: "内容工作台",
    icon: Compass,
  },
  {
    to: "/p/$projectId/site-pages" as const,
    label: "页面清单",
    icon: Files,
  },
  {
    to: "/p/$projectId/page-plans" as const,
    label: "页面计划",
    icon: CalendarCheck,
  },
  {
    to: "/p/$projectId/search-performance" as const,
    label: "GSC Insights",
    icon: GoogleGlyphMuted,
  },
  {
    to: "/p/$projectId/domain" as const,
    label: "Domain Overview",
    icon: Globe,
  },
  {
    to: "/p/$projectId/backlinks" as const,
    label: "Backlinks",
    icon: Link2,
  },
  {
    to: "/p/$projectId/audit" as const,
    label: "Site Audit",
    icon: ClipboardCheck,
  },
  {
    to: "/p/$projectId/brand-lookup" as const,
    label: "Brand Lookup",
    icon: Sparkles,
  },
  {
    to: "/p/$projectId/prompt-explorer" as const,
    label: "Prompt Explorer",
    icon: MessageSquare,
  },
  {
    to: "/p/$projectId/reports" as const,
    label: "Reports",
    icon: FileText,
  },
  {
    to: "/p/$projectId/context" as const,
    label: "Context",
    icon: Brain,
  },
] as const;

// Project-independent. Rendered inside the project "AI" group when a project
// is selected, and on its own (connectNavGroup) when none is.
const aiNavItem = linkOptions({
  to: "/ai" as const,
  label: "Agent setup",
  icon: Bot,
});

const opportunitiesNavItem = linkOptions({
  to: "/opportunities" as const,
  label: "Opportunities",
  icon: Telescope,
});

const sitesNavItem = linkOptions({
  to: "/sites" as const,
  label: "站点总览",
  icon: Network,
});

const learningsNavItem = linkOptions({
  to: "/learnings" as const,
  label: "学习文档",
  icon: BookOpen,
});

// Always-visible sidebar group. Discover holds the cross-project opportunity
// funnel (specs/0012) — it has no project context by design.
export const discoverNavGroup = {
  label: "Discover",
  items: [opportunitiesNavItem, learningsNavItem],
};

// Cross-project site registry: repos, hosting, templates, markets.
export const portfolioNavGroup = {
  label: "Portfolio",
  items: [sitesNavItem],
};

// Shown only when no project is selected; with a project, Agent setup lives in
// the "AI" group below.
export const connectNavGroup = {
  label: "AI",
  items: [aiNavItem],
};

function getProjectNavItems(projectId: string) {
  return linkOptions(
    projectNavItems.map((item) => ({
      ...item,
      params: { projectId },
      search: {},
    })),
  );
}

// Grouped by scope: "My Site" is the project's own domain (tracked data),
// "Research" is point-at-anything lookup tools.
export function getProjectNavGroups(projectId: string) {
  const all = getProjectNavItems(projectId);
  const byPath = (path: (typeof projectNavItems)[number]["to"]) =>
    all.find((i) => i.to === path)!;

  return [
    {
      label: "Overview",
      items: [byPath("/p/$projectId")],
    },
    {
      label: "Research",
      items: [
        byPath("/p/$projectId/keywords"),
        byPath("/p/$projectId/domain"),
        byPath("/p/$projectId/backlinks"),
        byPath("/p/$projectId/brand-lookup"),
        byPath("/p/$projectId/prompt-explorer"),
      ],
    },
    {
      label: "My Site",
      items: [
        byPath("/p/$projectId/search-performance"),
        byPath("/p/$projectId/rank-tracking"),
        byPath("/p/$projectId/saved"),
        byPath("/p/$projectId/candidate-keywords"),
        byPath("/p/$projectId/content-ops"),
        byPath("/p/$projectId/site-pages"),
        byPath("/p/$projectId/page-plans"),
        byPath("/p/$projectId/audit"),
      ],
    },
    {
      label: "AI",
      items: [
        byPath("/p/$projectId/reports"),
        byPath("/p/$projectId/context"),
        aiNavItem,
      ],
    },
  ];
}

export const dataforseoHelpLinkOptions = linkOptions({
  to: "/help/dataforseo-api-key",
});
