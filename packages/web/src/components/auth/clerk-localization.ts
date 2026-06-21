import type { ClerkProviderProps } from "@clerk/react";

export const VENVIEWER_CLERK_LOCALIZATION = {
  locale: "en-GB",
  formButtonPrimary: "Continue",
  formFieldLabel__emailAddress_username: "Email address or username",
  formFieldInputPlaceholder__emailAddress_username: "Enter email or username",
  signIn: {
    start: {
      title: "Sign in to Venviewer",
      subtitle: "Welcome back. Continue to your venue planning workspace.",
      actionText: "Do not have an account?",
      actionLink: "Sign up",
    },
    password: {
      title: "Enter your Venviewer password",
      subtitle: "Continue securely to your planning workspace.",
      actionLink: "Use another method",
    },
    forgotPassword: {
      title: "Reset your Venviewer password",
      subtitle: "Enter your account email and Clerk will send a reset code.",
      subtitle_email: "Enter your account email and Clerk will send a reset code.",
      subtitle_phone: "Enter your phone number and Clerk will send a reset code.",
      formTitle: "Reset password",
      resendButton: "Resend code",
    },
  },
  signUp: {
    start: {
      title: "Create your Venviewer account",
      subtitle: "Start planning venues with evidence, proposals, and operations in one workspace.",
      actionText: "Already have an account?",
      actionLink: "Sign in",
    },
    continue: {
      title: "Complete your Venviewer account",
      subtitle: "Add the remaining details to open your planning workspace.",
      actionText: "Already have an account?",
      actionLink: "Sign in",
    },
  },
} satisfies NonNullable<ClerkProviderProps["localization"]>;
