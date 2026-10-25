import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { EditCommentBody, EditReviewBody, PublishBody, ReviewListQuery, SettingsUpdate } from './types';

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
};

export const useHealth = () => useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 30_000 });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings });
export const useInbox = () => useQuery({ queryKey: keys.inbox, queryFn: api.inbox });
export const useProjects = () => useQuery({ queryKey: keys.projects, queryFn: api.projects });
export const useProject = (repo: string) => useQuery({ queryKey: keys.project(repo), queryFn: () => api.project(repo) });
export const useReviews = (query: ReviewListQuery = {}) => useQuery({ queryKey: keys.reviews(query), queryFn: () => api.reviews(query) });
export const useReview = (id: string) => useQuery({ queryKey: keys.review(id), queryFn: () => api.review(id) });
export const useReviewDiff = (id: string) => useQuery({ queryKey: keys.reviewDiff(id), queryFn: () => api.reviewDiff(id) });
export const useActivity = () => useQuery({ queryKey: keys.activity, queryFn: () => api.activity() });

export function usePollNow() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: api.poll, onSuccess: () => qc.invalidateQueries({ queryKey: keys.health }) });
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
    mutationFn: ({ cid, body }: { cid: string; body: EditCommentBody }) => api.editComment(id, cid, body),
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
