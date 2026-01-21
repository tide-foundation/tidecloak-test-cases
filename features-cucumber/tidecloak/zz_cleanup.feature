@tidecloak @admin @cleanup
Feature: TideCloak Cleanup
  As a TideCloak administrator
  I want to clean up test resources
  So that test runs don't leave state behind

  Background:
    Given I have a running TideCloak server

  @user @delete
  Scenario: Delete a user
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I search for the test user
    And I delete the user
    Then I should see "The user has been deleted"
    And the user should not be visible in the user list

  @iga @disable
  Scenario: Disable IGA for realm
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I disable IGA for the realm
    Then I should see "IGA changed successfully"
    And the change request buttons should not be visible

  @license @delete
  Scenario: Delete license and Tide provider
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I cancel the Stripe subscription
    And I delete the Tide identity provider
    Then I should see "Provider successfully deleted"
    And I should see the identity provider options

  @realm @delete
  Scenario: Delete a realm
    Given I am logged into TideCloak admin console
    And I select realm "testrealm"
    When I delete the realm
    Then I should see "The realm has been deleted"
    And the realm "testrealm" should not be visible in the realm list
