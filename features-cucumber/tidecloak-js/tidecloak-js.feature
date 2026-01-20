@tidecloak-js
Feature: TideCloak JS SDK
  As a developer
  I want to use @tidecloak/js SDK
  So that I can add TideCloak auth to vanilla JS apps

  Background:
    Given I have a running TideCloak server on port 8080

  @admin-config
  Scenario: Fetch adapter config via admin UI
    Given I allocate a free port for the app
    When I log into TideCloak admin console
    And I create myrealm if it does not exist
    And I create myclient if it does not exist
    And I configure myclient with app redirect URIs
    And I update CustomAdminUIDomain
    And I request a license
    And I download the adapter config
    Then I have valid adapter JSON

  @vite-setup
  Scenario: Create Vite app with SDK
    Given I have fetched the adapter config
    When I create a Vite vanilla app
    And I install @tidecloak/js
    And I write the app files with IAMService
    Then the app is configured

  @auth-flow
  Scenario: Verify authentication flow
    Given the Vite app is configured
    When I start the Vite dev server
    And I navigate to the app
    And I click Log In
    And I sign up or sign in with Tide
    Then I see Authenticated status
    And I see Log Out button
