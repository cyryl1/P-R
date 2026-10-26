import { FolderPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useProjects } from '@/api/hooks';
import { ErrorState, LoadingState } from '@/components/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatRelative } from '@/lib/utils';

export const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

function NewProjectDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [repo, setRepo] = useState('');
  const valid = REPO_PATTERN.test(repo.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onClose();
    navigate(`/projects/${repo.trim()}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="New project"
      description="Enter the repository this rules file will cover."
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">
          Repository
          <Input
            className="mt-1"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/repo"
            autoFocus
            aria-invalid={repo !== '' && !valid}
          />
        </label>
        {repo !== '' && !valid ? (
          <p className="text-sm text-destructive">Use the form owner/repo.</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function Projects() {
  const { data, error, isPending, refetch } = useProjects();
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <Button onClick={() => setCreating(true)}>
          <FolderPlus className="h-4 w-4" aria-hidden /> New project
        </Button>
      </div>
      {isPending ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No projects yet. PRs from repos without a rules file are never
          reviewed.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="py-2 font-normal">Repo</th>
              <th className="font-normal">Enabled</th>
              <th className="font-normal">Rules file</th>
              <th className="font-normal">Rules</th>
              <th className="font-normal">Updated</th>
            </tr>
          </thead>
          <tbody>
            {data.map((project) => (
              <tr key={project.repo} className="border-b border-border">
                <td className="py-2">
                  <Link
                    className="font-medium hover:underline"
                    to={`/projects/${project.repo}`}
                  >
                    {project.repo}
                  </Link>
                </td>
                <td>{project.enabled ? 'Yes' : 'No'}</td>
                <td>
                  {project.valid ? (
                    <Badge variant="success">Valid</Badge>
                  ) : (
                    <Badge variant="destructive">
                      Invalid · {project.errorCount}{' '}
                      {project.errorCount === 1 ? 'error' : 'errors'}
                    </Badge>
                  )}
                </td>
                <td>{project.ruleCount}</td>
                <td className="text-muted-foreground">
                  {formatRelative(project.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
    </section>
  );
}
