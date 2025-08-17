Feature: Delete license  and delete Tide as Identity provider in Tidecloak
    As a Tide Cloak admin user
    I want to remove Tide as am Identity provider

  Scenario: Admin deletes the license and deletes Tide provider in "testrealm"
    Given the admin is logged in to the Tidecloak admin console
    When the admin deletes license and deletes Tide provider in "testrealm"
    Then the realm "testrealm" should have all providers visible in the Identity provider page