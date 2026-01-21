@tidecloak @admin
Feature: TideCloak Admin Console
  As a TideCloak administrator
  I want to manage realms, users, and licenses
  So that I can configure TideCloak for my organization

  Background:
    Given I have a running TideCloak server

  @login
  Scenario: Admin login with valid credentials
    When I open the TideCloak admin login page
    And I login as admin with valid credentials
    Then I should see the admin dashboard

  @login @negative
  Scenario: Admin login with invalid credentials
    When I open the TideCloak admin login page
    And I login as admin with invalid credentials
    Then I should see "Invalid username or password"

  @realm @create
  Scenario: Create a new realm
    Given I am logged into TideCloak admin console
    When I create a realm named "testrealm"
    Then I should see "Realm created successfully"
    And the realm "testrealm" should be visible in the realm list

  @smtp @configure @email
  Scenario: Configure SMTP settings
    Given I am logged into TideCloak admin console
    And SMTP is configured
    And I select realm "testrealm"
    When I enable email verification
    And I configure SMTP server with admin name "TideCloak Admin"
    Then I should see "Realm successfully updated"
    And I set admin email in master realm

  @license
  Scenario: Add Tide provider and get license
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I add Tide identity provider
    And I request a license with email "test@tide.org"
    Then I should see license details
    And I enable Link Tide Account required action

  @iga @enable
  Scenario: Enable IGA for realm
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I enable IGA for the realm
    Then I should see "IGA changed successfully"
    And the change request table for clients is visible

  @user @create
  Scenario: Create a new user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I create a new test user
    Then I should see the user settings tabs
    And I should see the user created timestamp

  @user @password
  Scenario: Set user password
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I set password "TestPass123!" for the user
    Then I should see "The password has been set"
    And I should see the reset password button

  @user @link-account
  Scenario: Link Tide account for user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I copy the Link Tide Account link
    And I open the link in a new tab
    And I sign up or sign in with Tide
    Then I should see "Your account has been updated"

  @user @verify-email
  Scenario: Copy email verification link
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I copy the Verify Email link
    And I open the link in a new tab
    Then I should see the email verification page

  @user @disable
  Scenario: Disable a user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I disable the user
    Then I should see "The user has been saved"
    And the user should show "Disabled" status

  @user @disable @negative
  Scenario: Disabled user cannot login
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    And the test user is disabled
    When I try to login as the test user with password "TestPass123!"
    Then I should see "Account is disabled" in popup

  @user @enable
  Scenario: Enable a disabled user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    And the test user is disabled
    When I enable the test user
    Then I should see "The user has been saved"
    And the user should not show "Disabled" status

  @user @role
  Scenario: Assign admin role to user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I assign the "tide-realm-admin" role
    And I approve and commit the change request
    Then I should see the role with "ACTIVE" status
