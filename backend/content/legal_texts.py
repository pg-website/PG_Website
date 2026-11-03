"""Approved legal page wording as content blocks (see content/validation.py `_blocks` for the block shapes)."""
from __future__ import annotations

EMAIL = 'Official.pawnsgambit@gmail.com'
ADDRESS = '501, Sri Sai Sudharshan Homes, Narendra Nagar Colony, Ameenpur, Hyderabad – 502032, Telangana, India'


def h2(text):
    return {'type': 'heading', 'level': 2, 'text': text}


def h3(text):
    return {'type': 'heading', 'level': 3, 'text': text}


def p(text):
    return {'type': 'paragraph', 'text': text}


def ul(*items):
    return {'type': 'list', 'ordered': False, 'items': list(items)}


PRIVACY_TITLE = 'Privacy Policy'
PRIVACY_EFFECTIVE_DATE = '2026-06-26'  # Effective and last updated: 26 June 2026

PRIVACY_BLOCKS = [
    h2('1. Introduction'),
    p("Welcome to pgchess.in, the official website of Pawn's Gambit."),
    p('This Privacy Policy explains how we collect, use, store, disclose and protect your personal information when you '
      'use our website, register for tournaments, participate in events, communicate with us or use any services '
      'provided through pgchess.in.'),
    p('By accessing or using this website, you agree to the collection and use of information in accordance with this '
      'Privacy Policy.'),

    h2('2. Website Operator'),
    p('pgchess.in is owned and operated by Sairam Kolaganti, operating under the brand name Pawn\'s Gambit.'),
    p(f'Email: {EMAIL}'),
    p(f'Address: {ADDRESS}'),
    p("Pawn's Gambit currently operates as an independent brand and community platform."),

    h2('3. Information We Collect'),
    p('We collect information that you voluntarily provide as well as certain technical information necessary for '
      'operating the website.'),
    h3('Personal Information'),
    p('When registering for tournaments, leagues, workshops or contacting us, we may collect:'),
    ul('Full Name', 'Email Address', 'Mobile Number', 'Date of Birth or Age', 'Gender (if requested)',
       'Residential Area / Locality', 'City', 'Emergency Contact (where applicable)',
       'Parent/Guardian details for minors', 'Chess.com Username', 'Lichess Username', 'FIDE Rating (if applicable)',
       'PG Rating', 'Tournament History', 'Profile Photograph (where applicable)'),
    h3('Payment Information'),
    p('Payments made through pgchess.in are processed using Razorpay. We do not collect or store credit/debit card '
      'numbers, CVV, UPI PIN or net banking passwords. Payment information is securely handled by Razorpay according '
      'to their own Privacy Policy and security standards.'),
    h3('Event Information'),
    p("When participating in Pawn's Gambit events we may collect registration details, attendance history, tournament "
      'results, match history, leaderboard rankings, PG Ratings, and community participation history.'),
    h3('Photographs & Videos'),
    p('During events we may capture photographs, videos, interviews, testimonials and audio recordings. These may be '
      'used for community and promotional purposes.'),

    h2('4. Information Automatically Collected'),
    p('When you visit pgchess.in, we may automatically collect limited technical information including device type, '
      'browser type, operating system, IP address, date & time of visit, pages visited, and website performance logs.'),
    p('At present, pgchess.in does not intentionally use Google Analytics or advertising tracking services.'),

    h2('5. WhatsApp Communications'),
    p('Users may voluntarily opt into receiving updates through WhatsApp. By opting in, you consent to receiving '
      'messages regarding tournament registrations, event reminders, leaderboards, PG Ratings, community '
      'announcements, promotions and future events. You may opt out at any time by contacting us or leaving the '
      'relevant WhatsApp group.'),

    h2('6. How We Use Your Information'),
    p('We use your information to register participants for tournaments, process payments, issue refunds, publish '
      'tournament pairings and standings, maintain PG Ratings, verify player identities, contact participants, send '
      'event updates, improve website functionality and community experience, resolve disputes, detect fraud, enforce '
      'our Terms & Conditions, and comply with applicable laws.'),

    h2('7. Public Player Information'),
    p("Pawn's Gambit is a community-driven chess platform. To facilitate tournaments and maintain transparent "
      'competition, certain participant information will be publicly available, including name, PG Rating, '
      'leaderboard position, tournament history, tournament results, rankings, and community achievements.'),
    p("By registering for a Pawn's Gambit event, you consent to the publication of this information. PG Ratings are "
      "community ratings created solely by Pawn's Gambit and are not official FIDE ratings."),

    h2('8. Event Photography & Media Consent'),
    p("Pawn's Gambit regularly photographs and records its tournaments and events. By participating in our events you "
      "grant Pawn's Gambit permission to use your name, image, photograph, video, voice and testimonial for purposes "
      'including Instagram, website, WhatsApp communities, event recaps, promotional campaigns, marketing material '
      'and community stories.'),
    p('No compensation shall be payable for such usage unless separately agreed. If you have concerns regarding a '
      f'specific photograph or video, contact us at {EMAIL}. Reasonable requests will be reviewed individually.'),

    h2('9. Information Sharing'),
    p('We do not sell your personal information. Your information may be shared only where reasonably necessary with '
      'Razorpay, event venues, tournament arbiters, volunteers, technology providers, website hosting providers, and '
      'legal authorities where required by law.'),

    h2('10. Data Security'),
    p('We take reasonable administrative and technical measures to protect your personal information from '
      'unauthorized access, misuse or disclosure. However, no website or online service can guarantee complete '
      'security. Users acknowledge that internet transmissions always carry inherent security risks.'),

    h2('11. Data Retention'),
    p('We retain information only as long as reasonably necessary to maintain tournament records, PG Ratings, '
      'historical standings, resolve disputes, comply with legal obligations, and maintain financial records. '
      "Tournament history and public leaderboards may remain permanently available as part of Pawn's Gambit's "
      'historical archives.'),

    h2('12. Minors'),
    p("Minors may participate in Pawn's Gambit events. Registration of minors should be completed by a parent or "
      "legal guardian where applicable. Pawn's Gambit does not currently provide private messaging functionality "
      'between users through pgchess.in.'),

    h2('13. Your Rights'),
    p('Subject to applicable law, you may request access to your information, correction of inaccurate information, '
      'updating your information, withdrawal of promotional communications, and deletion of certain personal '
      'information where legally permissible.'),
    p('Some information such as tournament history, PG Ratings and public standings may continue to be retained where '
      f'necessary for community records or legal compliance. Requests may be sent to {EMAIL}.'),

    h2('14. Third-Party Services'),
    p('Our website may contain links to third-party services including Razorpay, Instagram, WhatsApp, Lichess and '
      "Chess.com. These services operate under their own Privacy Policies. Pawn's Gambit is not responsible for their "
      'content or privacy practices.'),

    h2('15. Cookies'),
    p('At present, pgchess.in does not intentionally use cookies for advertising or analytics purposes. If cookies or '
      'analytics technologies are introduced in the future, this Privacy Policy will be updated accordingly.'),

    h2('16. Changes to this Privacy Policy'),
    p('We may revise this Privacy Policy periodically. The latest version will always be available on pgchess.in. '
      'Continued use of the website after any update constitutes acceptance of the revised Privacy Policy.'),

    h2('17. Contact Us'),
    p("Sairam Kolaganti — Operator, Pawn's Gambit"),
    p(f'Email: {EMAIL}'),
    p(f'Address: {ADDRESS}'),

    h2('18. Governing Law'),
    p('This Privacy Policy shall be governed by and interpreted in accordance with the laws of India. Any disputes '
      'arising from this Privacy Policy shall be subject to the exclusive jurisdiction of the courts located in '
      'Hyderabad, Telangana.'),
]


TERMS_TITLE = 'Terms & Conditions'
TERMS_EFFECTIVE_DATE = '2026-06-26'  # Effective and last updated: 26 June 2026

TERMS_BLOCKS = [
    p('Welcome to pgchess.in ("Website"), operated by Sairam Kolaganti under the brand name Pawn\'s Gambit. These Terms '
      '& Conditions govern your use of the Website and your participation in any tournament, event, workshop, league, '
      'membership, community activity, or service offered through pgchess.in.'),
    p('By accessing this Website, registering for an event, creating a profile, making a payment, or participating in a '
      "Pawn's Gambit event, you acknowledge that you have read, understood, and agree to be bound by these Terms. If "
      "you do not agree, please do not use the Website or participate in any Pawn's Gambit activity."),

    h2('1. Website Operator'),
    p("Website: pgchess.in · Brand: Pawn's Gambit"),
    p('Sairam Kolaganti'),
    p(f'Email: {EMAIL}'),
    p(f'Address: {ADDRESS}'),

    h2('2. Eligibility'),
    p('You must have the legal capacity to enter into a binding agreement to use this Website. Participants under the '
      'age of 18 may register and participate in events. Where required, registration must be completed or approved '
      'by a parent or legal guardian. By registering a minor, the parent or guardian confirms they are authorised to '
      "do so and agrees to these Terms on the minor's behalf."),

    h2('3. Services'),
    p("Pawn's Gambit offers community-based chess activities including but not limited to chess tournaments, "
      'community leagues, workshops, casual meetups, chess events, leaderboards, PG Ratings, community rankings, event '
      'registrations, and future memberships. We reserve the right to modify, suspend or discontinue any service, '
      'feature or event at any time.'),

    h2('4. User Registration'),
    p('To register for an event, users may be required to provide accurate information including name, mobile number, '
      'email address, age or date of birth, residential area, Chess.com username, Lichess username, FIDE rating (if '
      'applicable), and emergency contact (where required). You agree that all information provided is true and '
      'accurate. Providing false or misleading information may result in cancellation of your registration.'),

    h2('5. Payments'),
    p('Payments for registrations are processed securely through Razorpay. Your registration is confirmed only after '
      "successful payment. Pawn's Gambit does not store your payment card details. Payment processing is subject to "
      "Razorpay's own Terms and Privacy Policy."),

    h2('6. Refund & Cancellation Policy'),
    h3('Participant Cancellation'),
    p('Participants are eligible for a 100% refund only if the cancellation request is received at least two (2) '
      'calendar days before the scheduled tournament date. No refunds will be provided for cancellations made within '
      'two days of the event, no-shows, late arrivals resulting in missed participation, disqualification due to '
      'misconduct, or rule violations. Refunds will be processed through the original payment method wherever '
      'reasonably possible.'),
    h3('Event Cancellation'),
    p("If Pawn's Gambit cancels an event entirely, every registered participant will receive a full refund. If an "
      'event is postponed rather than cancelled, registrations may be transferred to the new event date.'),

    h2('7. Tournament Rules'),
    p('Each tournament may have additional rules covering pairings, time controls, tie-break systems, fair play, mobile '
      'phone usage, reporting of results, prize distribution, venue regulations, team events, league formats, and PG '
      'Rating calculations. Participants agree to comply with all tournament rules announced before or during the '
      'event. The decisions of organisers and designated arbiters regarding tournament administration shall be final.'),

    h2('8. Code of Conduct'),
    p('All participants are expected to maintain a respectful and welcoming environment. Participants must not cheat '
      'or manipulate results, use chess engines during games, engage in abusive behaviour, harass other participants, '
      "use threatening language, damage venue property, disrupt events, submit false information, misuse another "
      "participant's personal information, or conduct unauthorised commercial activities during Pawn's Gambit events."),
    p("Pawn's Gambit reserves the right to remove any participant from an event without refund if they violate these "
      'Terms or the event rules.'),

    h2('9. PG Ratings & Leaderboards'),
    p('Pawn\'s Gambit maintains its own community rating system known as the PG Rating. By participating in events, you '
      'agree that your name, PG Rating, tournament history, leaderboard position, match results, community '
      'achievements and rankings may be publicly displayed on pgchess.in. PG Ratings are community-created ratings and '
      "are not official FIDE ratings. Pawn's Gambit reserves the right to modify the PG Rating system at any time."),

    h2('10. Event Photography & Media'),
    p("Pawn's Gambit regularly photographs and records tournaments, workshops and community events. By participating "
      "in any event, you grant Pawn's Gambit permission to use your name, photograph, video, voice, likeness and "
      'testimonials for website content, Instagram, WhatsApp communities, promotional campaigns, event highlights, '
      'community stories and marketing materials. No additional compensation shall be payable for such use. For '
      'minors, consent is deemed to have been provided by the registering parent or legal guardian.'),

    h2('11. Intellectual Property'),
    p('Unless otherwise stated, all content on pgchess.in including the logo, branding, website content, event names, '
      'tournament concepts, graphics, designs, photographs, videos, PG Rating system, articles and downloads remain '
      "the intellectual property of Pawn's Gambit and/or Sairam Kolaganti. No content may be copied, reproduced, "
      'distributed or commercially used without prior written permission.'),

    h2('12. Website Usage'),
    p('Users agree not to attempt unauthorised access to the Website, introduce malicious software, scrape website '
      'data, copy participant information, misuse leaderboards, disrupt website functionality, impersonate another '
      "individual, or use the Website for unlawful purposes. Violation may result in suspension or permanent removal "
      "from the Website and future Pawn's Gambit events."),

    h2('13. Third-Party Services'),
    p('The Website may link to or integrate with third-party services including Razorpay, WhatsApp, Instagram, '
      "Chess.com and Lichess. Pawn's Gambit is not responsible for the availability, content or policies of these "
      'third-party services. Your use of those services is governed by their own terms.'),

    h2('14. Disclaimer'),
    p("Pawn's Gambit strives to organise high-quality community events. However, we do not guarantee uninterrupted "
      'Website availability, error-free operation, event availability, specific tournament formats, prize structures '
      'remaining unchanged, or continuous operation of third-party services. Event schedules, venues, formats and '
      'timings may change due to circumstances beyond our control.'),

    h2('15. Limitation of Liability'),
    p("To the maximum extent permitted under applicable law, Pawn's Gambit and Sairam Kolaganti shall not be liable "
      'for indirect losses, consequential damages, loss of profits, loss of opportunity, technical failures, payment '
      'gateway issues, venue-related disruptions, internet outages, acts of third parties, or participant misconduct. '
      'In any event, our total liability shall not exceed the amount actually paid by the participant for the specific '
      'registration giving rise to the claim. Nothing in these Terms limits liability where such limitation is '
      'prohibited by law.'),

    h2('16. Indemnity'),
    p("You agree to indemnify and hold harmless Pawn's Gambit, Sairam Kolaganti, volunteers, organisers, arbiters and "
      'partners against any claims, liabilities, damages, losses, expenses or legal costs arising from your breach of '
      "these Terms, your negligence, your misconduct, your violation of another person's rights, false information "
      'submitted by you, or the conduct of any minor registered by you.'),

    h2('17. Privacy'),
    p('Your use of pgchess.in is also governed by our Privacy Policy. By using the Website, you consent to the '
      'collection and processing of your information as described in the Privacy Policy.'),

    h2('18. Changes to These Terms'),
    p("Pawn's Gambit reserves the right to modify these Terms at any time. The updated version will be published on "
      'pgchess.in with a revised "Last Updated" date. Continued use of the Website after such updates constitutes '
      'acceptance of the revised Terms.'),

    h2('19. Governing Law'),
    p('These Terms shall be governed by and interpreted in accordance with the laws of India. Any dispute arising from '
      "the use of pgchess.in or participation in Pawn's Gambit activities shall be subject to the exclusive "
      'jurisdiction of the competent courts located in Hyderabad, Telangana.'),

    h2('20. Contact Information'),
    p("Sairam Kolaganti — Operator, Pawn's Gambit"),
    p(f'Email: {EMAIL}'),
    p(f'Address: {ADDRESS}'),
]

REFUND_TITLE = 'Refund & Cancellation Policy'
REFUND_EFFECTIVE_DATE = '2026-06-26'  # Same wording as section 6 of the Terms & Conditions

REFUND_BLOCKS = [
    p("This Refund & Cancellation Policy applies to registrations made through pgchess.in for Pawn's Gambit events. "
      'It forms part of our Terms & Conditions.'),

    h2('Participant Cancellation'),
    p('Participants are eligible for a 100% refund only if the cancellation request is received at least two (2) '
      'calendar days before the scheduled tournament date.'),
    p('No refunds will be provided for:'),
    ul('Cancellations made within two days of the event', 'No-shows',
       'Late arrivals resulting in missed participation', 'Disqualification due to misconduct, or rule violations'),
    p('Refunds will be processed through the original payment method wherever reasonably possible.'),

    h2('Event Cancellation'),
    p("If Pawn's Gambit cancels an event entirely, every registered participant will receive a full refund. If an "
      'event is postponed rather than cancelled, registrations may be transferred to the new event date.'),

    h2('Payments'),
    p('Payments are processed securely through Razorpay, and your registration is confirmed only after successful '
      "payment. Pawn's Gambit does not store your payment card details."),

    h2('Contact'),
    p(f'To request a cancellation or ask about a refund, write to {EMAIL}.'),
]

# page slug -> (title, effective date, blocks).
LEGAL_PAGES = {
    'privacy': (PRIVACY_TITLE, PRIVACY_EFFECTIVE_DATE, PRIVACY_BLOCKS),
    'terms': (TERMS_TITLE, TERMS_EFFECTIVE_DATE, TERMS_BLOCKS),
    'refund-policy': (REFUND_TITLE, REFUND_EFFECTIVE_DATE, REFUND_BLOCKS),
}
