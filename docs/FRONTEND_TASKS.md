# Skycar V2 — Frontend Workstream

Owner: App Developer
Coordinator: Project Manager

## Foundation
- Establish application framework and folder structure
- Routing
- Auth session handling
- Role-aware navigation
- Shared component system
- Form validation layer
- API client
- Error boundary
- Loading/empty/error states
- Responsive/mobile-first shell

## Customer
### Garage
- Garage dashboard
- Add/edit vehicle
- Vehicle detail
- Condition summary
- History timeline
- Membership/benefit cards
- Recommended actions

### Repair & Cleaning
- Service category selector
- Vehicle selector
- Guided photo capture/upload
- Damage/service details
- Estimate/quote screen
- Availability selection
- Booking confirmation
- Payment UI
- Booking tracking
- Completion evidence
- Review/guarantee flow

## Technician
- Onboarding
- Profile
- Service capability setup
- Service area
- Availability
- Job list
- Job detail
- Accept/decline
- In-progress workflow
- Before/after upload
- Earnings

## Fleet
- Fleet dashboard
- Vehicle register
- Vehicle detail
- Inspection flow
- Damage list
- Repair actions
- Cost/status views

## Admin
- Dashboard
- Users
- Technicians
- Bookings
- Fleet accounts
- Pricing/config
- Disputes/guarantees
- Audit history

## Frontend acceptance baseline
Every screen must account for:
- loading
- empty
- validation error
- API error
- offline/retry where practical
- permission denied
- success state

Do not mock permanent business logic in the frontend. Temporary mocks must be clearly marked and removed before integration completion.
