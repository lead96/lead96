import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalPage, List } from "@/components/legal";
import { COMPANY } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy", description: "How Lead96 collects, uses and protects personal information." };

export default function PrivacyPage() {
  const mail = <a href={`mailto:${COMPANY.email}`} className="text-brand-700 hover:underline">{COMPANY.email}</a>;
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <>
          <p>
            {COMPANY.brand} ({COMPANY.website}) is operated by {COMPANY.legalName}, {COMPANY.street}, {COMPANY.city}, {COMPANY.country} (&quot;we&quot;,
            &quot;us&quot;). {COMPANY.brand} is a platform for home-service businesses (&quot;contractors&quot;): it collects their customer requests, calls and
            texts those customers with an AI assistant, and helps book appointments.
          </p>
          <p>This policy explains what personal information we process, why, who we share it with, and the choices you have.</p>
        </>
      }
    >
      <Clause title="1. Who this applies to">
        <List
          items={[
            <><b>Contractors and their team</b> who use the {COMPANY.brand} app.</>,
            <><b>People who ask a contractor for service</b>, for example by filling in a form on a landing page hosted on {COMPANY.website}, on a Google or Facebook ad form, or by calling a contractor&apos;s number.</>,
          ]}
        />
        <p>
          For requests sent to a contractor, the contractor decides how the information is used for their business; we process it on their behalf to
          run the service.
        </p>
      </Clause>

      <Clause title="2. Information we collect">
        <List
          items={[
            <><b>Contact and request details</b> you send: name, phone number, email, ZIP code or address, the service you need, and your answers to the form or call questions.</>,
            <><b>Consent records</b>: the consent text you agreed to, when, the page, your IP address and browser type.</>,
            <><b>Calls and texts</b> with the AI assistant: recordings, transcripts, summaries and the details you give (for example a preferred visit time).</>,
            <><b>Ad and page information</b>: the ad campaign, keyword or page that brought you, and click IDs from Google or Facebook.</>,
            <><b>Account information</b> of contractors and their team: name, email, business details, settings and activity in the app.</>,
            <><b>Technical data</b>: sign-in cookies needed to keep you logged in, and server logs for security.</>,
          ]}
        />
      </Clause>

      <Clause title="3. How we use it">
        <List
          items={[
            "To pass your request to the contractor you contacted and to keep their customer records.",
            "To call or text you about your request, answer your questions, and schedule, confirm or remind you of appointments, if you agreed to be contacted.",
            "To show contractors which ads and pages bring customers.",
            "To keep the service secure, prevent abuse, and meet legal duties.",
            "To improve the service, for example by reviewing calls where the AI was unsure.",
          ]}
        />
        <p>We do not sell personal information.</p>
      </Clause>

      <Clause title="4. AI calls, recordings and texts">
        <p>
          Calls from and to a contractor&apos;s {COMPANY.brand} number may be answered or made by an <b>automated AI phone assistant</b>. The assistant says that it is
          an AI assistant and that the call may be recorded. Recordings and transcripts are stored so the contractor can follow up and check quality.
        </p>
        <p>
          If you ask not to be called or texted again, or reply <b>STOP</b> to a text, we mark your number and stop AI calls and texts for that contractor.
        </p>
      </Clause>

      <Clause title="5. Text messages (SMS)" id="sms">
        <p>
          <b>
            No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. Text messaging originator opt-in
            data and consent will not be shared with any third parties.
          </b>{" "}
          Your phone number and consent are used only to send the messages you agreed to (about your service request, scheduling and reminders) and are
          processed by the service providers that deliver them.
        </p>
        <p>
          Message frequency varies. Message and data rates may apply. Reply STOP to opt out at any time, or HELP for help. See the{" "}
          <Link href="/terms#sms" className="text-brand-700 hover:underline">
            SMS terms
          </Link>
          .
        </p>
      </Clause>

      <Clause title="6. Who we share it with">
        <List
          items={[
            <>The <b>contractor</b> you asked for service.</>,
            <>
              <b>Service providers</b> that run parts of {COMPANY.brand} on our behalf: hosting and database (Vercel, Supabase), AI calls and texts (Retell AI and
              its phone carriers), AI text processing (OpenAI), email delivery (Resend).
            </>,
            <><b>Ad platforms</b> (Google, Meta) when you came through their ads or forms, as needed to receive your request and measure results.</>,
            "Authorities, when the law requires it.",
          ]}
        />
        <p>Service providers may only use the information to provide their service to us.</p>
      </Clause>

      <Clause title="7. Where it is stored and for how long">
        <p>
          Our main database is hosted in the United States. When information moves between the EU and the US, we rely on the safeguards the law
          provides (such as standard contractual clauses).
        </p>
        <p>
          We keep information while the contractor uses {COMPANY.brand} and as long as needed for the purposes above or required by law. Contractors can
          ask us to delete their customers&apos; records.
        </p>
      </Clause>

      <Clause title="8. Security">
        <p>
          Each contractor&apos;s data is kept separate from other contractors&apos; data. Access is limited to people who need it, sign-in secrets and keys are
          encrypted, and messages from our phone and ad partners are verified before we accept them. No system is perfectly secure, but we work to
          protect your information.
        </p>
      </Clause>

      <Clause title="9. Your rights and choices">
        <List
          items={[
            "Ask for a copy of your information, or to correct or delete it.",
            "Withdraw your consent to calls and texts at any time (reply STOP, or tell the assistant or the contractor).",
            "Depending on where you live (for example the EU, or US states such as California), you may have further rights, such as to object or to restrict processing, and to complain to a data protection authority.",
          ]}
        />
        <p>To use these rights, write to {mail}. If your request is about a contractor&apos;s records, we will pass it on to them.</p>
      </Clause>

      <Clause title="10. Cookies">
        <p>We use only the cookies needed to sign in and keep the app working. We do not use advertising cookies on {COMPANY.website}.</p>
      </Clause>

      <Clause title="11. Children">
        <p>{COMPANY.brand} is not meant for children under 16, and we do not knowingly collect their information.</p>
      </Clause>

      <Clause title="12. Changes and contact">
        <p>
          We may update this policy; the date above shows the latest version. Questions: {COMPANY.legalName}, {COMPANY.street}, {COMPANY.city},{" "}
          {COMPANY.country}, {mail}.
        </p>
      </Clause>
    </LegalPage>
  );
}
