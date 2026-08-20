import { MarketingSiteShell } from '@/components/marketing/site-shell';
import { useMarketingSite } from '@/components/marketing/site-data';

const INFORMATION_COLLECTED = [
  'Full name',
  'Company or organization name',
  'Job title or position',
  'Email address',
  'Telephone or mobile number',
  'Postal or physical address',
  'Information provided when communicating with us',
];

const BUSINESS_INFORMATION = [
  'Services requested',
  'Project requirements',
  'Organization or business requirements',
  'Website and hosting requirements',
  'Technical requirements',
  'Support requests',
  'Contract and service information',
  'Billing and transaction information',
];

const TECHNICAL_INFORMATION = [
  'IP address',
  'Browser type and version',
  'Device type',
  'Operating system',
  'Date and time of access',
  'Pages visited',
  'Referring website',
  'General website interaction information',
  'Security and diagnostic information',
];

const PERSONAL_INFORMATION_USES = [
  'Respond to enquiries and requests',
  'Provide quotations and proposals',
  'Provide and manage our services',
  'Communicate with clients and prospective clients',
  'Provide technical support',
  'Manage hosting, websites, software and IT infrastructure services',
  'Process contracts and business transactions',
  'Manage customer accounts',
  'Issue invoices and maintain business records',
  'Improve our website, products and services',
  'Maintain the security and integrity of our systems',
  'Detect, investigate and prevent fraud, abuse or unauthorized access',
  'Comply with legal and regulatory obligations',
  'Manage recruitment and employment-related enquiries where applicable',
  'Send relevant business communications where permitted by law',
];

const SERVICE_PROVIDERS = [
  'Website hosting',
  'Cloud infrastructure',
  'Domain and SSL services',
  'Email and communication services',
  'Payment processing',
  'Website analytics',
  'Security and monitoring',
  'IT infrastructure',
  'Software and business systems',
  'Professional and technical services',
];

const COOKIE_USES = [
  'Website functionality',
  'Security',
  'Session management',
  'Website performance',
  'Understanding website usage',
  'Improving user experience',
  'Analytics, where applicable',
];

const SECURITY_MEASURES = [
  'Unauthorized access',
  'Unauthorized disclosure',
  'Loss',
  'Destruction',
  'Alteration',
  'Misuse',
  'Other forms of unlawful processing',
];

const RETENTION_PURPOSES = [
  'Provide our services',
  'Maintain business and financial records',
  'Meet contractual obligations',
  'Resolve disputes',
  'Maintain security records',
  'Comply with legal and regulatory requirements',
  'Protect our legitimate business interests',
];

const DATA_RIGHTS = [
  'Be informed about how your personal information is being used',
  'Request access to personal information we hold about you',
  'Request correction of inaccurate or misleading personal information',
  'Object to certain processing of your personal information',
  'Request deletion of personal information where applicable',
  'Withdraw consent where processing is based on consent',
  'Exercise any other rights provided under applicable data protection law',
];

const POLICY_UPDATE_REASONS = [
  'Changes to our services',
  'Changes to our website',
  'Changes to technology',
  'Changes to applicable laws or regulations',
  'Improvements to our privacy practices',
];

function PolicyList({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 space-y-2 text-sm leading-7 text-[#4b5563]">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#111827]/70" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="rounded-[30px] border border-black/5 bg-white p-7 shadow-[0_16px_46px_rgba(17,24,39,0.05)] sm:p-9">
      <h2 className="text-2xl font-semibold tracking-tight text-[#111827]">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-7 text-[#4b5563]">{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage({ tenantCode }: { tenantCode?: string }) {
  const site = useMarketingSite(tenantCode);
  const brand = site.branding.primary_color ?? '#E85D26';

  return (
    <MarketingSiteShell site={site} tenantCode={tenantCode} currentPage="about">
      <section className="mx-auto max-w-7xl px-6 pb-10 pt-12 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-[#6b7280]">Privacy Policy</p>
          <h1 className="mt-4 text-[3rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#111827] sm:text-[4.2rem]">
            Your data deserves
            <span className="block italic" style={{ color: brand }}>clear handling and clear language.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[#4b5563]">
            This policy explains how Siakora Labs Limited collects, uses, stores, protects, and discloses personal
            information when you visit our website, request services, or otherwise interact with us.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-[#4b5563]">
            <span className="rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5">Effective Date: 13 August 2026</span>
            <span className="rounded-full bg-white px-4 py-2 shadow-sm ring-1 ring-black/5">Last Updated: 13 August 2026</span>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 sm:px-8 lg:px-10">
        <PolicySection id="introduction" title="1. Introduction">
          <p>
            Welcome to <strong>Siakora Labs Limited</strong>.
          </p>
          <p>
            Siakora Labs Limited (&quot;Siakora Labs&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) is a technology solutions company
            providing software development, systems integration, ERP solutions, SIEM solutions, EDMS solutions, data
            center and infrastructure solutions, web hosting, website design and development, computer networking, and
            related technology services.
          </p>
          <p>
            We respect your privacy and are committed to protecting the personal information entrusted to us.
          </p>
          <p>
            This Policy should be read together with any specific privacy notices that may be provided when we collect
            personal information through particular services, applications, forms, or systems.
          </p>
        </PolicySection>

        <PolicySection id="framework" title="2. Data Protection Framework">
          <p>
            Siakora Labs is committed to handling personal data in accordance with applicable data protection and
            privacy laws, including the <strong>Kenya Data Protection Act, 2019</strong>, and applicable regulations and
            guidance issued by the Office of the Data Protection Commissioner (ODPC).
          </p>
          <p>We aim to process personal information lawfully, fairly, transparently, and only for legitimate and specified purposes.</p>
        </PolicySection>

        <PolicySection id="information-we-collect" title="3. Information We Collect">
          <p>Depending on how you interact with us, we may collect the following categories of information.</p>
          <div>
            <p className="font-semibold text-[#111827]">3.1 Contact and Identification Information</p>
            <PolicyList items={INFORMATION_COLLECTED} />
          </div>
          <div>
            <p className="font-semibold text-[#111827]">3.2 Business and Service Information</p>
            <PolicyList items={BUSINESS_INFORMATION} />
          </div>
          <div>
            <p className="font-semibold text-[#111827]">3.3 Information Submitted Through Forms</p>
            <p>
              If you complete a contact, enquiry, quotation, support, recruitment, or other form on our website, we may
              collect the information you choose to provide and use it for the purpose for which it was submitted.
            </p>
          </div>
          <div>
            <p className="font-semibold text-[#111827]">3.4 Technical and Website Information</p>
            <PolicyList items={TECHNICAL_INFORMATION} />
          </div>
        </PolicySection>

        <PolicySection id="how-we-use-information" title="4. How We Use Personal Information">
          <p>We may use personal information for legitimate business purposes, including to:</p>
          <PolicyList items={PERSONAL_INFORMATION_USES} />
          <p>
            We will not collect or use personal information for purposes incompatible with the purpose for which it was
            originally collected unless permitted or required by applicable law.
          </p>
        </PolicySection>

        <PolicySection id="legal-basis" title="5. Legal Basis for Processing">
          <p>Depending on the circumstances, Siakora Labs may process personal information where:</p>
          <PolicyList
            items={[
              'You have provided consent',
              'Processing is necessary to provide a service or perform a contract with you',
              'Processing is necessary to comply with a legal obligation',
              'Processing is necessary to protect legitimate business interests',
              'Processing is necessary to protect the rights, security, or property of individuals or our organization',
              'Processing is otherwise permitted by applicable law',
            ]}
          />
          <p>Where processing is based on consent, you may withdraw your consent where permitted by law.</p>
        </PolicySection>

        <PolicySection id="sharing-and-disclosure" title="6. Information Sharing and Disclosure">
          <p>Siakora Labs does <strong>not sell personal information</strong> to third parties.</p>
          <p>We may share personal information where reasonably necessary with trusted service providers, legal and regulatory authorities, or as part of a legitimate business transaction.</p>
          <div>
            <p className="font-semibold text-[#111827]">Service Providers</p>
            <PolicyList items={SERVICE_PROVIDERS} />
          </div>
        </PolicySection>

        <PolicySection id="third-party-services" title="7. Third-Party Services">
          <p>
            Our website or services may contain links to or integrations with third-party services. These services may
            have their own privacy policies and terms, and Siakora Labs is not responsible for the privacy practices of
            third-party websites or services that we do not control.
          </p>
        </PolicySection>

        <PolicySection id="cookies" title="8. Cookies and Similar Technologies">
          <p>Our website may use cookies and similar technologies to support functionality, security, and user experience.</p>
          <PolicyList items={COOKIE_USES} />
          <p>
            You can manage or disable cookies through your browser settings, although disabling certain cookies may
            affect how parts of the website function.
          </p>
        </PolicySection>

        <PolicySection id="analytics" title="9. Analytics">
          <p>
            We may use analytics and similar technologies to understand how visitors use our website and to improve our
            online services. Where third-party analytics services are used, the information collected may be processed by
            those providers in accordance with their respective privacy policies.
          </p>
        </PolicySection>

        <PolicySection id="security" title="10. Data Security">
          <p>
            Siakora Labs takes reasonable technical and organizational measures to protect personal information against:
          </p>
          <PolicyList items={SECURITY_MEASURES} />
          <p>
            Depending on the nature of the information and service, security measures may include access controls,
            authentication mechanisms, secure communications, backups, monitoring, and system hardening.
          </p>
        </PolicySection>

        <PolicySection id="retention" title="11. Data Retention">
          <p>We retain personal information only for as long as reasonably necessary for purposes such as:</p>
          <PolicyList items={RETENTION_PURPOSES} />
          <p>
            When personal information is no longer required, we will take reasonable steps to securely delete,
            anonymize, or otherwise dispose of it, subject to applicable legal or legitimate retention requirements.
          </p>
        </PolicySection>

        <PolicySection id="international-transfers" title="12. International Data Transfers">
          <p>
            Some of our technology providers or service providers may operate outside Kenya. Where personal information
            is transferred outside Kenya, Siakora Labs will take appropriate steps to ensure that the transfer is
            handled in accordance with applicable data protection requirements and that appropriate safeguards are in
            place.
          </p>
        </PolicySection>

        <PolicySection id="rights" title="13. Your Data Protection Rights">
          <p>Subject to applicable law, you may have rights in relation to your personal information, including the right to:</p>
          <PolicyList items={DATA_RIGHTS} />
        </PolicySection>

        <PolicySection id="exercise-rights" title="14. How to Exercise Your Rights">
          <p>
            To make a privacy or data protection request, please contact us using the details below. Your request should
            provide sufficient information to allow us to understand and respond to it, and we may take reasonable steps
            to verify your identity before processing certain requests.
          </p>
        </PolicySection>

        <PolicySection id="children" title="15. Children's Privacy">
          <p>
            Our website and services are primarily intended for businesses, organizations, and general users. We do not
            knowingly collect personal information from children for purposes that are not permitted by law.
          </p>
        </PolicySection>

        <PolicySection id="marketing" title="16. Direct Marketing and Communications">
          <p>
            We may occasionally send information relating to our services, products, technology solutions, events, or
            other business communications. Where consent is required, we will obtain appropriate consent before sending
            marketing communications.
          </p>
        </PolicySection>

        <PolicySection id="client-data" title="17. Client and Customer Data">
          <p>
            Where Siakora Labs provides software development, ERP, EDMS, hosting, systems integration, data center,
            networking, SIEM, or other technology services, we may process personal information belonging to our
            clients&apos; customers, employees, suppliers, or other users.
          </p>
          <p>
            In such circumstances, Siakora Labs may act as a <strong>data processor or service provider</strong> on behalf
            of the relevant client, depending on the nature of the engagement.
          </p>
        </PolicySection>

        <PolicySection id="breaches" title="18. Data Breaches and Security Incidents">
          <p>
            Siakora Labs maintains reasonable measures designed to detect, prevent, and respond to security incidents
            involving personal information. Where a personal data breach occurs, we will investigate, contain, remediate,
            and make any notifications required by applicable law.
          </p>
        </PolicySection>

        <PolicySection id="external-sites" title="19. Third-Party Websites">
          <p>
            Our website may contain links to external websites operated by third parties. We encourage you to review the
            privacy policy of each third-party website before providing personal information.
          </p>
        </PolicySection>

        <PolicySection id="changes" title="20. Changes to This Privacy Policy">
          <p>We may update this Privacy Policy from time to time to reflect:</p>
          <PolicyList items={POLICY_UPDATE_REASONS} />
          <p>The Last Updated date at the beginning of this Policy indicates when the Policy was most recently revised.</p>
        </PolicySection>

        <PolicySection id="contact" title="21. Contact Us">
          <p>If you have questions about this Privacy Policy or want to exercise your data protection rights, please contact us:</p>
          <div className="rounded-[24px] bg-[#f5f2ed] p-5 text-sm leading-7 text-[#111827]">
            <p><strong>Siakora Labs Limited</strong></p>
            <p><strong>Phone:</strong> +254 741 070 462</p>
            <p><strong>Email:</strong> info@siakoralabs.co.ke</p>
            <p><strong>Website:</strong> www.siakoralabs.co.ke</p>
            <p><strong>Location:</strong> Nairobi, Kenya</p>
            <p><strong>Subject:</strong> Data Protection / Privacy Request</p>
          </div>
        </PolicySection>

        <PolicySection id="complaints" title="22. Complaints">
          <p>
            If you believe that your personal information has been handled in a manner that violates applicable data
            protection law, you are encouraged to contact Siakora Labs first so that we can investigate and attempt to
            resolve the matter.
          </p>
          <p>
            You may also have the right to lodge a complaint with the <strong>Office of the Data Protection Commissioner
            (ODPC)</strong> in Kenya.
          </p>
          <p className="pt-2 text-xs uppercase tracking-[0.2em] text-[#6b7280]">© 2026 Siakora Labs Limited. All Rights Reserved.</p>
        </PolicySection>
      </section>
    </MarketingSiteShell>
  );
}
