@tidecloak @email
Feature: TideCloak Email Configuration
  As a TideCloak administrator
  I want to configure email settings
  So that I can send email notifications to users

  Background:
    Given I have a running TideCloak server
    And SMTP is configured

  @email @send
  Scenario: Send email verification to user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I send email verification
    Then I verify the email was received

  @password @recovery
  Scenario: Password recovery via email
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When the test user requests password recovery
    And I collect recovery links from email
    And I complete the recovery process with new password "NewPass456!"
    Then I should see account recovered message
    And I can log in with the new password "NewPass456!"
