import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from './client';
import type {
  AddCommentBody,
  EditCommentBody,
  EditReviewBody,
  PollStatus,
  PublishBody,
  ReviewListQuery,
  SettingsUpdate,
} from './types';

export const keys = {
  health: ['health'] as const,
  settings: ['settings'] as const,
  inbox: ['inbox'] as const,
  projects: ['projects'] as const,
  project: (repo: string) => ['projects', repo] as const,
  reviews: (query: ReviewListQuery) => ['reviews', query] as const,
  review: (id: string) => ['review', id] as const,
  reviewDiff: (id: string) => ['review', id, 'diff'] as const,
  activity: ['activity'] as const,
  pollStatus: ['poll-status'] as const,
};

export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: api.health,
    refetchInterval: 30_000,
  });
export const useSettings = () =>
  useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useInbox = () =>
  useQuery({ queryKey: keys.inbox, queryFn: api.inbox });
export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useProject = (repo: string) =>
  useQuery({ queryKey: keys.project(repo), queryFn: () => api.project(repo) });
export const useReviews = (query: ReviewListQuery = {}) =>
  useQuery({
    queryKey: keys.reviews(query),
    queryFn: () => api.reviews(query),
  });
const IN_PROGRESS = ['queued', 'gathering', 'reviewing', 'publishing'];

/** SSE pushes updates; the slow poll is a safety net while a review is generating. */
export const useReview = (id: string) =>
  useQuery({
    queryKey: keys.review(id),
    queryFn: () => api.review(id),
    refetchInterval: (query) =>
      IN_PROGRESS.includes(query.state.data?.status ?? '') ? 5_000 : false,
  });
export const useReviewDiff = (id: string) =>
  useQuery({
    queryKey: keys.reviewDiff(id),
    queryFn: () => api.reviewDiff(id),
  });
const PAGE_SIZE = 20;

/** Cursor-paginated review history; `useReviews` stays for single-page callers. */
export const useReviewHistory = (query: Omit<ReviewListQuery, 'cursor'>) =>
  useInfiniteQuery({
    queryKey: ['reviews', 'history', query] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.reviews({
        ...query,
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

export const useActivity = () =>
  useInfiniteQuery({
    queryKey: [...keys.activity, 'list'] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.activity({ limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor,
  });

/** Latest `poll.status` pushed over SSE; undefined until the first event. */
export const usePollStatus = () =>
  useQuery<PollStatus | undefined>({
    queryKey: keys.pollStatus,
    queryFn: () => undefined,
    enabled: false,
  });

export function usePollNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.poll,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.health }),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsUpdate) => api.updateSettings(body),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

export function useSaveProject(repo: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (yaml: string) => api.saveProject(repo, yaml),
    onSuccess: (data) => {
      qc.setQueryData(keys.project(repo), data);
      return qc.invalidateQueries({ queryKey: keys.projects });
    },
  });
}

export function useCreateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prUrl: string) => api.createReview(prUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.inbox }),
  });
}

export function useAddComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddCommentBody) => api.addComment(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review(id) }),
  });
}

export function useDeleteComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cid: string) => api.deleteComment(id, cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review(id) }),
  });
}

export function useRerunReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.rerunReview(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['review'] }),
  });
}

export function useDismissReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.dismissReview(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review(id) }),
  });
}

export function useEditReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EditReviewBody) => api.editReview(id, body),
    onSuccess: (data) => qc.setQueryData(keys.review(id), data),
  });
}

export function useEditComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cid, body }: { cid: string; body: EditCommentBody }) =>
      api.editComment(id, cid, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review(id) }),
  });
}

export function usePublishReview(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PublishBody) => api.publishReview(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review(id) }),
  });
}
