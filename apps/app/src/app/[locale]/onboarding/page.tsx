"use client";

import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { api } from "@v1/backend/convex/_generated/api";
import * as validators from "@v1/backend/convex/utils/validators";
import { Button } from "@v1/ui/button";
import { Input } from "@v1/ui/input";
import { useMutation, useQuery } from "convex/react";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

export default function OnboardingUsername() {
  const user = useQuery(api.users.getUser);
  const updateUsername = useMutation(api.users.updateUsername);
  const provisionStorage = useAction(api.provisioning.provisionDefaultStorage);
  const router = useRouter();

  const { pending } = useFormStatus();

  const [provisioned, setProvisioned] = useState<null | {
    bucketName: string;
    credential: {
      accessKeyId: string;
      secretKey: string;
    } | null;
    provisionError: string | null;
  }>(null);

  const [submitted, setSubmitted] = useState(false);

  const form = useForm({
    validatorAdapter: zodValidator(),
    defaultValues: {
      username: "",
    },
    onSubmit: async ({ value }) => {
      setSubmitted(true);
      await updateUsername({
        username: value.username,
      });
      // Auto-provision private storage right after the username is set.
      // The secret is shown exactly once below. A provisioning failure must
      // not block onboarding — the user can create storage later.
      try {
        // The action returns unknown through the client bindings; narrow it
        // at runtime instead of assuming the shape.
        const res = (await provisionStorage({})) as {
          bucketName?: unknown;
          credential?: {
            accessKeyId?: unknown;
            secretKey?: unknown;
          } | null;
        };
        const bucketName =
          typeof res.bucketName === "string" ? res.bucketName : "";
        const accessKeyId =
          typeof res.credential?.accessKeyId === "string"
            ? res.credential.accessKeyId
            : null;
        const secretKey =
          typeof res.credential?.secretKey === "string"
            ? res.credential.secretKey
            : null;
        setProvisioned({
          bucketName,
          credential:
            accessKeyId && secretKey ? { accessKeyId, secretKey } : null,
          provisionError: null,
        });
      } catch (e) {
        setProvisioned({
          bucketName: "",
          credential: null,
          provisionError:
            e instanceof Error ? e.message : "Storage provisioning failed.",
        });
      }
    },
  });

  useEffect(() => {
    if (!user) {
      return;
    }
    // Don't bounce away after submit — the success panel (with the
    // show-once secret) has its own Continue button.
    if (user?.username && !submitted) {
      router.push("/");
    }
  }, [user, submitted]);

  if (!user) {
    return null;
  }

  // Success screen: private storage is ready (or the error, if provisioning
  // failed). The S3 secret is displayed exactly once — it is never stored
  // in readable form afterwards.
  if (provisioned) {
    return (
      <div className="mx-auto flex h-full w-full max-w-96 flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <span className="mb-2 select-none text-6xl">🎉</span>
          <h3 className="text-center text-2xl font-medium text-primary">
            Your storage is ready!
          </h3>
          {provisioned.bucketName ? (
            <p className="text-center text-base font-normal text-primary/60">
              Private bucket{" "}
              <span className="font-mono text-primary">
                {provisioned.bucketName}
              </span>{" "}
              was created for you.
            </p>
          ) : (
            <p className="text-center text-base font-normal text-destructive">
              {provisioned.provisionError ??
                "Storage provisioning failed — you can create it later from Buckets."}
            </p>
          )}
        </div>
        {provisioned.credential && (
          <div className="w-full rounded-lg border border-border bg-card p-4 text-sm">
            <p className="mb-2 font-medium text-primary">
              Your S3 credentials (shown once)
            </p>
            <p className="text-xs text-primary/60">Access key ID</p>
            <p className="mb-2 select-all font-mono text-primary">
              {provisioned.credential.accessKeyId}
            </p>
            <p className="text-xs text-primary/60">Secret access key</p>
            <p className="select-all break-all font-mono text-primary">
              {provisioned.credential.secretKey}
            </p>
            <p className="mt-2 text-xs text-primary/60">
              Save it now — it cannot be shown again. Use endpoint{" "}
              <span className="font-mono">http://127.0.0.1:3211/s3/</span> with
              any S3-compatible client.
            </p>
          </div>
        )}
        <Button
          size="sm"
          className="w-full"
          onClick={() => router.push("/")}
        >
          Continue to dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-96 flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <span className="mb-2 select-none text-6xl">👋</span>
        <h3 className="text-center text-2xl font-medium text-primary">
          Welcome!
        </h3>
        <p className="text-center text-base font-normal text-primary/60">
          Let's get started by choosing a username.
        </p>
      </div>
      <form
        className="flex w-full flex-col items-start gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="flex w-full flex-col gap-1.5">
          <label htmlFor="username" className="sr-only">
            Username
          </label>
          <form.Field
            name="username"
            validators={{
              onSubmit: validators.username,
            }}
            // biome-ignore lint/correctness/noChildrenProp: tanstack best practice
            children={(field) => (
              <Input
                placeholder="Username"
                autoComplete="off"
                required
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                className={`bg-transparent ${
                  field.state.meta?.errors.length > 0 &&
                  "border-destructive focus-visible:ring-destructive"
                }`}
              />
            )}
          />
        </div>

        <div className="flex flex-col">
          {form.state.fieldMeta.username?.errors.length > 0 && (
            <span className="mb-2 text-sm text-destructive dark:text-destructive-foreground">
              {form.state.fieldMeta.username?.errors.join(" ")}
            </span>
          )}
        </div>

        <Button type="submit" size="sm" className="w-full">
          {pending ? <Loader2 className="animate-spin" /> : "Continue"}
        </Button>
      </form>

      <p className="px-6 text-center text-sm font-normal leading-normal text-primary/60">
        You can update your username at any time from your account settings.
      </p>
    </div>
  );
}
