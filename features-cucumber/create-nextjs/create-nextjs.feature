@create-nextjs
Feature: TideCloak Create-NextJS CLI
  As a developer
  I want to use @tidecloak/create-nextjs CLI
  So that I can scaffold TideCloak-enabled Next.js apps

  Background:
    Given I have a running TideCloak server

  @cli
  Scenario: Create Next.js app via CLI
    Given I allocate ports for TideCloak and the app
    When I run the create-nextjs CLI with project name "nextjs-app-under-test"
    And I respond to CLI prompts with TideCloak configuration
    Then the CLI outputs an invite link

  @link-account
  Scenario: Link Tide account from invite
    Given the CLI has output an invite link
    When I open the invite link in the browser
    And I sign up or sign in with Tide
    Then the CLI completes successfully

  @dev-server
  Scenario: Run scaffolded app
    Given the CLI has completed successfully
    When I run npm install in the project directory
    And I start the scaffolded Next.js dev server
    Then the app is accessible

  @login-flow
  Scenario: Verify login flow
    Given the scaffolded app is running
    When I navigate to the app URL
    Then I see Welcome heading and Log In button
    When I click Log In and sign in
    Then I see "Hello,"
    And I see "Has default roles?"
    When I click "Verify Token"
    Then I see "Authorized"
    When I click Log out
    Then I see the Welcome page
