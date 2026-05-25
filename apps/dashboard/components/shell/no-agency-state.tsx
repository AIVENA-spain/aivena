import { logoutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function NoAgencyState({ email }: { email: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Almost there</CardTitle>
          <CardDescription>
            You&apos;re not assigned to an agency yet — contact your
            administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border bg-card px-3 py-2 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Signed in as
            </div>
            <div className="font-medium text-foreground">{email}</div>
          </div>
        </CardContent>
        <CardFooter>
          <form action={logoutAction} className="w-full">
            <Button type="submit" variant="outline" className="w-full">
              Log out
            </Button>
          </form>
        </CardFooter>
      </Card>
    </main>
  );
}
