@tidecloak-nextjs
Feature: TideCloak NextJS SDK App Router
  As a developer
  I want to use @tidecloak/nextjs SDK
  So that I can build secure Next.js apps

  Background:
    Given I have a running TideCloak server on port 8080

  @scaffold
  Scenario: Scaffold Next.js app with SDK
    Given I allocate a free port for the app
    When I run create-next-app with App Router
    And I install @tidecloak/nextjs
    Then the project is created

  @adapter
  Scenario: Configure TideCloak adapter
    Given the Next.js project exists
    When I fetch adapter config via admin UI
    And I write tidecloakAdapter.json
    Then the adapter config is valid

  @app-router
  Scenario: Configure App Router structure
    Given the adapter config is in place
    When I create layout.tsx with TideCloakProvider
    And I create Header.tsx with useTideCloak hook
    And I create auth redirect page
    And I create dashboard with guard components
    And I create middleware with route protection
    Then the App Router structure is complete

  @auth
  Scenario: Verify authentication
    Given the App Router is configured
    When I start the Next.js dev server
    And I navigate to the root URL
    Then I see Log In button
    When I navigate to /dashboard
    Then I should see "Please log in to access the dashboard"
    When I go back and click Log In
    And I sign up or sign in with Tide
    Then I see Dashboard heading
