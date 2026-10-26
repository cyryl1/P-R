import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/api/client';
import { keys, useProject, useSaveProject } from '@/api/hooks';
import {
  ErrorState,
  errorMessage,
  LoadingState,
} from '@/components/ErrorState';
import { ParsedSummary } from '@/components/projects/ParsedSummary';
import { ReferenceDrawer } from '@/components/projects/ReferenceDrawer';
import {
  YamlEditor,
  type YamlEditorHandle,
} from '@/components/projects/YamlEditor';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { useDebounced } from '@/lib/useDebounced';

/** Loads the saved rules file, or the starter template when none exists yet. */
function useRulesSource(repo: string) {
  const project = useProject(repo);
  const missing =
    project.error instanceof ApiError && project.error.code === 'NO_RULES';
  const template = useQuery({
    queryKey: ['template', repo],
    queryFn: () => api.projectTemplate(repo),
    enabled: missing,
  });
  return { project, missing, template };
}

export function ProjectEditor() {
  const { owner = '', repo: name = '' } = useParams();
  const repo = `${owner}/${name}`;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const editor = useRef<YamlEditorHandle>(null);

  const { project, missing, template } = useRulesSource(repo);
  const baseline = project.data?.yaml ?? template.data?.yaml;
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Seed the editor once the first copy of the text arrives.
  useEffect(() => {
    if (baseline !== undefined && text === null) {
      setText(baseline);
      setSaved(project.data ? project.data.yaml : null);
    }
  }, [baseline, text, project.data]);

  const current = text ?? '';
  const debounced = useDebounced(current, 400);
  const validation = useQuery({
    queryKey: ['validate', repo, debounced],
    queryFn: () => api.validateProject(debounced),
    enabled: text !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const settled =
    validation.data !== undefined &&
    debounced === current &&
    !validation.isFetching;
  const errors = validation.data?.errors ?? [];
  const isValid = settled && validation.data?.valid === true;
  const isNew = saved === null;
  const dirty = text !== null && text !== saved;

  const saveProject = useSaveProject(repo);
  const save = useCallback(() => {
    if (!isValid || !dirty || saveProject.isPending) return;
    saveProject.mutate(current, {
      onSuccess: (doc) => {
        setSaved(doc.yaml);
        toast.success(`Saved rules for ${repo}`);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  }, [isValid, dirty, saveProject, current, repo, toast]);

  const remove = useMutation({
    mutationFn: () => api.deleteProject(repo),
    onSuccess: async () => {
      setSaved(current); // nothing left to lose; skip the unsaved guard
      await qc.invalidateQueries({ queryKey: keys.projects });
      toast.success(`Deleted rules for ${repo}`);
      navigate('/projects');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Ctrl/Cmd+S saves, wherever focus is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Unsaved-changes guard for in-app navigation and tab close.
  const blocker = useBlocker(
    dirty && !saveProject.isPending && !remove.isPending,
  );
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  if (project.isPending || (missing && template.isPending))
    return <LoadingState />;
  if (project.error && !missing)
    return (
      <ErrorState
        error={project.error}
        onRetry={() => void project.refetch()}
      />
    );
  if (template.error)
    return (
      <ErrorState
        error={template.error}
        onRetry={() => void template.refetch()}
      />
    );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{repo}</h1>
          <p className="text-sm text-muted-foreground">
            {isNew
              ? 'New rules file — not saved yet'
              : dirty
                ? 'Unsaved changes'
                : 'Saved'}
          </p>
        </div>
        <div className="flex gap-2">
          {isNew ? null : (
            <Button variant="outline" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
          <Button
            onClick={save}
            disabled={!isValid || !dirty || saveProject.isPending}
            title="Ctrl/Cmd+S"
          >
            {saveProject.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
        <YamlEditor
          ref={editor}
          value={current}
          onChange={setText}
          errors={errors}
        />
        <div className="space-y-4">
          <section
            aria-label="Validation"
            className="rounded-md border border-border p-4 text-sm"
          >
            <h2 className="mb-2 font-medium">Validation</h2>
            {!settled ? (
              <p className="text-muted-foreground" role="status">
                Checking…
              </p>
            ) : errors.length === 0 ? (
              <p className="text-success-foreground">
                The rules file is valid.
              </p>
            ) : (
              <ul className="space-y-1">
                {errors.map((error, index) => (
                  <li key={`${error.path}-${index}`}>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() =>
                        editor.current?.jumpTo(error.line ?? 1, error.column)
                      }
                    >
                      <span className="text-muted-foreground">
                        {error.line ? `Line ${error.line} · ` : ''}
                      </span>
                      <code className="text-xs">{error.path}</code>:{' '}
                      {error.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section
            aria-label="Parsed summary"
            className="rounded-md border border-border p-4"
          >
            <h2 className="mb-2 text-sm font-medium">
              Parsed summary{' '}
              <span className="font-normal text-muted-foreground">
                (last saved version)
              </span>
            </h2>
            {project.data?.parsed ? (
              <ParsedSummary parsed={project.data.parsed} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to summarise until a valid file is saved.
              </p>
            )}
          </section>
        </div>
      </div>

      <ReferenceDrawer />

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete rules for ${repo}?`}
        description="PRs from this repo will no longer be reviewed until you add a rules file again."
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => {
          setConfirmingDelete(false);
          remove.mutate();
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Discard unsaved changes?"
        description="Your edits to this rules file have not been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      />
    </section>
  );
}
