import { Button, Card, Empty, Typography } from 'antd';
import { Link, useLocation } from 'react-router-dom';

/**
 * A screen that does not exist yet, said plainly.
 *
 * The navigation is built from what the *API* supports, which is more than
 * the UI has caught up with. A menu item that led to a blank page would
 * look like a bug and leave the user wondering whether their data was
 * missing; this says which screen is not built, and confirms the records
 * behind it are fine.
 */
export function NotBuilt() {
  const location = useLocation();
  return (
    <Card>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <>
            <Typography.Paragraph strong style={{ marginBottom: 4 }}>
              This screen is not built yet
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              <code>{location.pathname}</code> is supported by the API but has no screen. Nothing is wrong with your
              records — there is simply nothing here to show them with yet.
            </Typography.Paragraph>
          </>
        }
      >
        <Link to="/">
          <Button type="primary">Back to the dashboard</Button>
        </Link>
      </Empty>
    </Card>
  );
}
