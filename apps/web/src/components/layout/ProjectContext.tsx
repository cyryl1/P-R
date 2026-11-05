import type { InboxItem } from '@pr-reviewer/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMatch } from 'react-router-dom';
import { useInbox, useProjects, useReview } from '@/api/hooks';
import { isDone, nextToReview } from '@/lib/inboxStatus';

const STORAGE_KEY = 'pr-reviewer.project';

export interface ProjectOption {
  repo: string;
  /** PRs in this project that still need a review from you. */
  waiting: number;
}

interface ProjectState {
  /** The project whose PRs are listed; undefined until the first PR or project loads. */
  project: string | undefined;
  projects: ProjectOption[];
  setProject: (repo: string) => void;
  /** Inbox items in the selected project. */
  items: InboxItem[];
}

const ProjectContext = createContext<ProjectState | undefined>(undefined);

const readStored = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * Which project (repo) the app is looking at. An open review wins, then the last
 * choice, then the project with the newest PR that needs attention.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const inbox = useInbox();
  const configured = useProjects();
  const reviewId = useMatch('/reviews/:id')?.params.id ?? '';
  const open = useReview(reviewId);
  const [chosen, setChosen] = useState(readStored);

  const all = useMemo(() => inbox.data ?? [], [inbox.data]);
  const projects = useMemo<ProjectOption[]>(() => {
    const repos = new Set([
      ...all.map((i) => i.pr.repo),
      ...(configured.data ?? []).map((p) => p.repo),
    ]);
    if (open.data) repos.add(open.data.repo);
    return [...repos].sort().map((repo) => ({
      repo,
      waiting: all.filter(
        (i) =>
          i.pr.repo === repo &&
          i.relation !== 'authored' &&
          i.rulesState === 'ok' &&
          !isDone(i),
      ).length,
    }));
  }, [all, configured.data, open.data]);

  const setProject = useCallback((repo: string) => {
    setChosen(repo);
    try {
      localStorage.setItem(STORAGE_KEY, repo);
    } catch {
      /* private mode: the choice just will not persist */
    }
  }, []);

  // Opening a review in another project (pasted link, deep link) switches to it.
  const openRepo = open.data?.repo;
  useEffect(() => {
    if (openRepo) setProject(openRepo);
  }, [openRepo, setProject]);

  const project =
    openRepo ??
    (chosen && projects.some((p) => p.repo === chosen) ? chosen : undefined) ??
    nextToReview(all)?.pr.repo ??
    projects[0]?.repo;
  const items = useMemo(
    () => all.filter((i) => i.pr.repo === project),
    [all, project],
  );

  const value = useMemo(
    () => ({ project, projects, setProject, items }),
    [project, projects, setProject, items],
  );
  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject(): ProjectState {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject needs a ProjectProvider');
  return ctx;
}
