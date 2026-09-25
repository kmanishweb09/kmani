import { Link } from "../app/router";
import { PageHead } from "../components/PageHead";
import { EmptyState } from "../components/ui";

export function NotFoundPage() {
  return (
    <div className="mf-stack">
      <PageHead title="Page not found" />
      <EmptyState title="This finance page does not exist" icon="search" action={<Link className="mf-btn" to="/finance">Go to the Desk</Link>}>
        Check the address, or search with Ctrl/Cmd + K.
      </EmptyState>
    </div>
  );
}
